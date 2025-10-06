const { Transaction, Connection, clusterApiUrl } = window.solanaWeb3 || {};


// ======= Вспомогательная функция для декодирования base64 в Uint8Array =======
function base64ToUint8Array(base64) {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// ========== Общие функции авторизации и управления токеном ==========

/**
 * Обновляет интерфейс авторизации.
 * Если token присутствует – показывает кнопку "Профиль" и "Выйти",
 * иначе – кнопку "Войти / Зарегистрироваться".
 *
 * @param {string|null} token - Токен авторизации (или null, если пользователь не авторизован)
 */
function updateAuthUI(token) {
  const authContainer = document.querySelector(".auth");
  if (!authContainer) return;

  authContainer.innerHTML = ""; // Очищаем контейнер перед обновлением

  if (token) {
    console.log("✅ Пользователь авторизован, обновляем интерфейс...");
    authContainer.innerHTML = `
      <a href="profile.html" class="btn profile-btn" data-i18n="profileBtn">Профиль</a>
      <button class="btn logout-btn" data-i18n="logoutBtn">Выйти</button>
    `;
    // Добавляем обработчик выхода
    const logoutBtn = authContainer.querySelector(".logout-btn");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", logoutUser);
    }
  } else {
    console.log("❌ Пользователь не авторизован, показываем кнопку входа...");
    authContainer.innerHTML = `
      <a href="login.html" class="btn auth-btn" data-i18n="authLogin">Войти / Зарегистрироваться</a>
    `;
  }
}

/**
 * Выходит из системы: удаляет токен, обновляет интерфейс и перенаправляет на страницу входа.
 */
function logoutUser() {
  console.log("🚪 Выход из системы...");
  localStorage.removeItem("authToken");
  updateAuthUI(null);
  window.location.href = "login.html"; // При необходимости измените URL
}

/**
 * Проверяет срок действия токена и, если осталось менее 5 минут – запрашивает новый токен.
 */
async function checkTokenExpiration() {
  const token = localStorage.getItem("authToken");
  if (!token) return;

  try {
    const payload = JSON.parse(atob(token.split(".")[1])); // Декодируем payload токена
    const exp = payload.exp * 1000; // Время истечения в миллисекундах
    const now = Date.now();

    if (exp - now < 5 * 60 * 1000) {
      console.log("⏰ Токен скоро истечет, пробуем обновить...");
      const response = await fetch("/api/refresh-token", {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}` }
      });
      const data = await response.json();

      if (data.success && data.newToken) {
        console.log("✅ Токен обновлен!");
        localStorage.setItem("authToken", data.newToken);
        updateAuthUI(data.newToken);
      } else {
        console.warn("❌ Не удалось обновить токен, требуется повторный вход.");
        logoutUser();
      }
    }
  } catch (error) {
    console.error("Ошибка проверки токена:", error);
    logoutUser();
  }
}

// ========== Функции для загрузки профиля пользователя ==========

/**
 * Загружает данные профиля пользователя.
 * Если токен отсутствует – перенаправляет на страницу входа.
 */
async function loadUserProfile() {
  const token = localStorage.getItem("authToken");
  if (!token) {
    console.log("Пользователь не авторизован, перенаправление...");
    window.location.href = "login.html";
    return;
  }

  try {
    const response = await fetch("/api/user-info", {
      method: "GET",
      headers: { "Authorization": `Bearer ${token}` }
    });
    const data = await response.json();

    if (data.success) {
      document.getElementById("username").textContent = data.username || "Аноним";
      document.getElementById("walletAddress").textContent = data.wallet || "Кошелек не подключен";
      document.getElementById("balance").textContent = `${data.balance} SOL`;
    } else {
      console.error("Ошибка загрузки профиля:", data.message);
    }
  } catch (error) {
    console.error("Ошибка загрузки профиля:", error);
  }
}

// ========== Функции Web3-интеграции (Solana) ==========

/**
 * Подключает кошелек Solana через Phantom и отправляет его адрес на сервер.
 */
async function connectWallet() {
  const errorContainer = document.getElementById("walletError"); // Блок для ошибок

  if (!window.solana || !window.solana.isPhantom) {
    errorContainer.textContent = "Установите Phantom кошелек!";
    errorContainer.style.color = "red";
    return;
  }

  try {
    const response = await window.solana.connect();
    const walletAddress = response.publicKey.toString();
    const token = localStorage.getItem("authToken");

    if (!token) {
      errorContainer.textContent = "Вы не авторизованы!";
      errorContainer.style.color = "red";
      return;
    }

    console.log("🔹 Отправка запроса /api/connect-wallet:");
    console.log("walletAddress:", walletAddress);
    console.log("token:", token);

    const serverResponse = await fetch("/api/connect-wallet", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ walletAddress: walletAddress })
    });

    const data = await serverResponse.json();
    if (data.success) {
      errorContainer.textContent = "✅ Кошелек успешно подключен!";
      errorContainer.style.color = "green";
      
      const walletAddressElem = document.getElementById("walletAddress");
      if (walletAddressElem) {
        walletAddressElem.textContent = walletAddress;
      }
    } else {
      errorContainer.textContent = "Ошибка: " + data.message;
      errorContainer.style.color = "red";
    }
  } catch (error) {
    console.error("Ошибка подключения кошелька:", error);
    errorContainer.textContent = "Ошибка подключения кошелька. Попробуйте позже.";
    errorContainer.style.color = "red";
  }
}

/**
 * Обновляет баланс кошелька в реальном времени.
 * Если кошелек подключен, запрашивает баланс каждые 30 секунд.
 */
async function updateBalance() {
  const walletAddressElem = document.getElementById("walletAddress");
  if (!walletAddressElem) return;
  const walletAddress = walletAddressElem.textContent;
  if (!walletAddress || walletAddress === "Кошелек не подключен") return;

  try {
    const response = await fetch(`/api/solana-balance?wallet=${walletAddress}`);
    const data = await response.json();
    if (data.success) {
      const balanceElem = document.getElementById("balance");
      if (balanceElem) {
        balanceElem.textContent = `${data.balance} SOL`;
      }
    }
  } catch (error) {
    console.error("Ошибка обновления баланса:", error);
  }
}

// ✅ Загружаем язык из URL, localStorage или cookie
function getSavedLanguage() {
  // 1️⃣ Проверяем URL (самый высокий приоритет)
  const urlParams = new URLSearchParams(window.location.search);
  const langFromURL = urlParams.get("lang");
  if (langFromURL) {
    console.log(`🔗 Язык найден в URL: ${langFromURL}`);
    return langFromURL;
  }

  // 2️⃣ Проверяем localStorage
  try {
    const langFromStorage = localStorage.getItem("selectedLanguage");
    if (langFromStorage) {
      console.log(`📂 Язык найден в localStorage: ${langFromStorage}`);
      return langFromStorage;
    }
  } catch (e) {
    console.warn("⚠️ Ошибка чтения localStorage, используем cookie");
  }

  // 3️⃣ Проверяем cookie
  const matches = document.cookie.match(/(?:^|; )selectedLanguage=([^;]*)/);
  if (matches) {
    console.log(`🍪 Язык найден в cookie: ${matches[1]}`);
    return matches[1];
  }

  // 4️⃣ Если ничего не найдено, возвращаем null
  return null;
}

// ✅ Сохранение языка в localStorage, cookie и URL (если нужно)
function saveLanguage(lang, updateURL = true) {
  try {
    localStorage.setItem("selectedLanguage", lang);
    console.log(`✅ Язык сохранен в localStorage: ${localStorage.getItem("selectedLanguage")}`);
  } catch (e) {
    console.warn("⚠️ localStorage недоступен, используем только cookie");
  }

  // Сохраняем в cookie
  document.cookie = `selectedLanguage=${lang}; path=/; max-age=31536000; SameSite=Lax`;

  console.log(`🍪 Язык сохранен в cookie: ${document.cookie}`);

  // Обновляем URL (если это не вызов из `loadSavedLanguage()`)
  if (updateURL) {
    const url = new URL(window.location);
    url.searchParams.set("lang", lang);
    window.history.replaceState({}, "", url);
  }
}

// ✅ Загрузка сохранённого языка и применение перевода
function loadSavedLanguage() {
  let savedLang = getSavedLanguage();

  if (!savedLang) {
    console.warn("⚠️ Язык не найден, используем русский.");
    savedLang = "ru";
    saveLanguage(savedLang, false); // Не обновляем URL, так как это дефолтное значение
  }

  console.log(`🔄 Загружаем язык: ${savedLang}`);
  translatePage(savedLang);
}


// ========== Система переводов (i18n) ==========
const translations = {
  ru: {
    heroTitle: "Эксклюзивные коллекции, доступные вам первыми",
    heroSubtitle: "Margo on SOL",
    heroBtn: "Откройте коллекции",
    navHome: "Главная",
    navAbout: "О нас",
    navCollections: "Коллекции",
    navDashboard: "Панель управления",
    authLogin: "Войти / Зарегистрироваться",
    profileBtn: "Профиль",
    logoutBtn: "Выйти",
    leftBlock1: "Solana Margo – это инновационная платформа, использующая блокчейн Solana для покупки эксклюзивного контента. Мы обеспечиваем быстрые транзакции, минимальные комиссии и максимальное удобство для пользователей.",
    leftBlock2: "Ваши данные остаются только у вас. Блокчейн Solana обеспечивает полную прозрачность и защиту транзакций, исключая посредников. Полный контроль над средствами – только у вас.",
    rightBlock1: "Эксклюзивные акции, аирдропы токенов, скидки и закрытые предложения – все это доступно подписчикам наших соцсетей. Не упусти шанс заработать и быть в курсе всех обновлений!",
    rightBlock2: "Margo – это не просто платформа, а экосистема. Владение нашим токеном дает доступ к уникальным возможностям, скидкам и эксклюзивному контенту. Присоединяйся сейчас, пока все только начинается!",
    loginTitle: "Вход / Регистрация",
    loginHeader: "Войти или Зарегистрироваться",
    emailLabel: "Email:",
    passwordLabel: "Пароль:",
    loginButton: "Войти",
    or: "или",
    registerButton: "Зарегистрироваться",
    solanaButton: "Войти через кошелек Solana",
    forgotPassword: "Забыли пароль?",
    backButton: "Назад",
    collectionsTitle: "Коллекции",
    filterAll: "Все",
    filterNew: "Новые",
    filterPopular: "Популярные",
    collection1Title: "Коллекция 1",
    collection1Desc: "Краткое описание коллекции",
    collection1Price: "Цена: 0.5 SOL",
    collection2Title: "Коллекция 2",
    collection2Desc: "Краткое описание коллекции",
    collection2Price: "Цена: 1.0 SOL",
    collection3Title: "Коллекция 3",
    collection3Desc: "Краткое описание коллекции",
    collection3Price: "Цена: 2.0 SOL",
    buyButton: "Купить",
    openButton: "Открыть",
    collectionViewTitle: "Просмотр коллекции",
    backToCollections: "Назад к коллекциям",
    dashboardTitle: "Панель управления автора",
    dashboardHeader: "Панель управления",
    addCollection: "Добавить новую коллекцию",
    dropPreview: "Перетащите превью изображения сюда или кликните для выбора",
    dropCollection: "Перетащите фото/видео коллекции сюда или кликните для выбора",
    collectionTitleLabel: "Название коллекции",
    collectionDescLabel: "Описание",
    collectionPriceLabel: "Цена в SOL",
    uploadBtn: "Загрузить",
    uploadedCollections: "Загруженные коллекции",
    tablePreview: "Превью",
    tableTitle: "Название",
    tableViews: "Просмотры",
    tableSales: "Продажи (SOL)",
    tableActions: "Действия",
    aboutTitle: "О нас",
    aboutHeader: "О нашей платформе",
    aboutText1: "Наша платформа предлагает уникальный опыт покупки эротического контента с использованием криптовалюты Solana.",
    aboutText2: "Мы предоставляем моделям новые возможности монетизации, а пользователям — удобный и быстрый доступ к контенту без посредников и ограничений.",
    featureFastTitle: "Только лучшие модели",
    featureFastDesc: "Эксклюзивный контент от популярных и новых лиц, доступный напрямую.",
    featureFeesTitle: "Быстрые и автоматизированные платежи",
    featureFeesDesc: "Нет задержек и сложных процессов – всё работает мгновенно.",
    featureSecurityTitle: "Безопасность и анонимность",
    featureSecurityDesc: "Шифрование данных, защита транзакций и полная конфиденциальность пользователей.",
    contactsTitle: "Контакты",
    joinBtn: "Присоединиться к нам",
    connectWallet: "Подключить кошелек"
  },
  en: {
    heroTitle: "Exclusive collections available to you first",
    heroSubtitle: "Margo on SOL",
    heroBtn: "Explore Collections",
    navHome: "Home",
    navAbout: "About",
    navCollections: "Collections",
    navDashboard: "Dashboard",
    authLogin: "Login / Register",
    profileBtn: "Profile",
    logoutBtn: "Logout",
    leftBlock1: "Solana Margo is an innovative platform that uses the Solana blockchain to purchase exclusive content. We provide fast transactions, minimal fees, and maximum convenience for users.",
    leftBlock2: "Your data remains only with you. Solana blockchain provides full transparency and protection of transactions, eliminating intermediaries. Full control over funds is only with you.",
    rightBlock1: "Exclusive promotions, token airdrops, discounts and closed offers - all this is available to subscribers of our social networks. Don't miss the chance to earn and stay up to date with all the updates!",
    rightBlock2: "Margo is not just a platform, but an ecosystem. Owning our token gives you access to unique opportunities, discounts, and exclusive content. Join now while it's just getting started!",
    loginTitle: "Login / Register",
    loginHeader: "Login or Register",
    emailLabel: "Email:",
    passwordLabel: "Password:",
    loginButton: "Login",
    or: "or",
    registerButton: "Register",
    solanaButton: "Login with Solana Wallet",
    forgotPassword: "Forgot password?",
    backButton: "Back",
    collectionsTitle: "Collections",
    filterAll: "All",
    filterNew: "New",
    filterPopular: "Popular",
    collection1Title: "Collection 1",
    collection1Desc: "Short description of the collection",
    collection1Price: "Price: 0.5 SOL",
    collection2Title: "Collection 2",
    collection2Desc: "Short description of the collection",
    collection2Price: "Price: 1.0 SOL",
    collection3Title: "Collection 3",
    collection3Desc: "Short description of the collection",
    collection3Price: "Price: 2.0 SOL",
    buyButton: "Buy",
    openButton: "Open",
    collectionViewTitle: "Collection View",
    backToCollections: "Back to Collections",
    dashboardTitle: "Author Dashboard",
    dashboardHeader: "Dashboard",
    addCollection: "Add New Collection",
    dropPreview: "Drag & drop preview image here or click to select",
    dropCollection: "Drag & drop collection media here or click to select",
    collectionTitleLabel: "Collection Title",
    collectionDescLabel: "Description",
    collectionPriceLabel: "Price in SOL",
    uploadBtn: "Upload",
    uploadedCollections: "Uploaded Collections",
    tablePreview: "Preview",
    tableTitle: "Title",
    tableViews: "Views",
    tableSales: "Sales (SOL)",
    tableActions: "Actions",
    aboutTitle: "About Us",
    aboutHeader: "About Our Platform",
    aboutText1: "Our platform offers a unique experience of purchasing erotic content using the Solana cryptocurrency.",
    aboutText2: "We provide models with new monetization opportunities, and users with convenient and fast access to content without intermediaries and restrictions.",
    featureFastTitle: "Only the best models",
    featureFastDesc: "Exclusive content from popular and new faces, accessible directly.",
    featureFeesTitle: "Fast and automated payments",
    featureFeesDesc: "There are no delays or complicated processes – everything works instantly.",
    featureSecurityTitle: "Security and anonymity",
    featureSecurityDesc: "Data encryption, transaction protection and complete user privacy.",
    contactsTitle: "Contacts",
    joinBtn: "Join Us",
    connectWallet: "Connect Wallet"
  }
};

/**
 * Применяет перевод ко всем элементам с data-i18n.
 * @param {string} lang - Выбранный язык ("ru" или "en")
 */
// ✅ Функция применения перевода
function translatePage(lang) {
  if (!translations[lang]) {
    console.warn("⚠️ Некорректный язык, ставим 'ru'");
    lang = "ru";
  }

  console.log(`🌍 Применяем перевод: ${lang}`);

  // Применяем перевод ко всем элементам с data-i18n
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (translations[lang] && translations[lang][key]) {
      el.textContent = translations[lang][key];
    }
  });

  // Обновляем UI текущего языка
  const currentLangElem = document.getElementById("currentLang");
  if (currentLangElem) {
    currentLangElem.textContent = lang.toUpperCase();
  }
}

// ✅ Применяем язык после полной загрузки страницы (вызовем только 1 раз)
document.addEventListener("DOMContentLoaded", () => {
  console.log("📌 DOM загружен, применяем сохраненный язык...");
  loadSavedLanguage();

  // Добавляем обработчик для переключателя языка
  const languageDropdown = document.getElementById("languageDropdown");
  if (languageDropdown) {
    languageDropdown.querySelectorAll("li").forEach((item) => {
      item.addEventListener("click", (e) => {
        const selectedLang = e.target.getAttribute("data-lang");
        console.log(`🔘 Выбран новый язык: ${selectedLang}`);
        saveLanguage(selectedLang); // Теперь вызываем сохранение отдельно
        translatePage(selectedLang);
      });
    });
  }
});

// ✅ Гарантируем, что после нажатия "назад" браузер не сбрасывает язык
window.addEventListener("pageshow", loadSavedLanguage);

// ========== Обработка форм и событий на странице ==========

document.addEventListener("DOMContentLoaded", () => {
  console.log("main.js успешно загружен");

  // Проверка токена при загрузке
  const token = localStorage.getItem("authToken");
  updateAuthUI(token);
  checkTokenExpiration();

  // Показываем контейнер авторизации, если он существует
  const authContainer = document.querySelector(".auth");
  if (authContainer) {
    authContainer.style.visibility = "visible";
  } else {
    console.warn("⚠️ Элемент .auth не найден в DOM!");
  }

  // Обновление профиля (если на странице profile.html)
  if (window.location.pathname.includes("profile.html")) {
    loadUserProfile();
  }

  // Подключение кошелька
  const connectWalletBtn = document.getElementById("connectWalletBtn");
  if (connectWalletBtn) {
    connectWalletBtn.addEventListener("click", connectWallet);
  }

  // Обновление баланса каждые 30 сек
  setInterval(updateBalance, 30000);

  // Перевод страницы
  const languageBtn = document.getElementById("languageBtn");
  const languageDropdown = document.getElementById("languageDropdown");
  if (languageBtn && languageDropdown) {
    languageBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      languageDropdown.classList.toggle("visible");
    });
    languageDropdown.querySelectorAll("li").forEach((item) => {
      item.addEventListener("click", (e) => {
        const selectedLang = e.target.getAttribute("data-lang");
        document.getElementById("currentLang").textContent = selectedLang.toUpperCase();
        languageDropdown.classList.remove("visible");
        translatePage(selectedLang);
      });
    });
    translatePage("ru");
  }

  // Форма авторизации по email
  // Обработчик формы авторизации
const authForm = document.getElementById("authForm");
if (authForm) {
  authForm.addEventListener("submit", function (e) {
    e.preventDefault();
    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;
    const errorContainer = document.getElementById("loginError"); // Блок для ошибки

    fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          localStorage.setItem("authToken", data.token);
          window.location.href = "index.html";
        } else {
          errorContainer.textContent = data.message; // Вывод ошибки под полем
          errorContainer.style.color = "red";
        }
      })
      .catch((err) => {
        errorContainer.textContent = "Ошибка сервера. Попробуйте позже.";
        errorContainer.style.color = "red";
      });
  });
}


  // Переключение между формами входа и регистрации
// Переключение между формами входа и регистрации
const toggleRegisterBtn = document.getElementById("toggleRegisterBtn");
const registerForm = document.getElementById("registerForm");

if (toggleRegisterBtn && registerForm) {
  toggleRegisterBtn.addEventListener("click", () => {
    if (registerForm.style.display === "none" || !registerForm.style.display) {
      registerForm.style.display = "block";
      toggleRegisterBtn.textContent = "Уже зарегистрированы? Войти";
    } else {
      registerForm.style.display = "none";
      toggleRegisterBtn.textContent = "Зарегистрироваться";
    }
  });
}

if (registerForm) {
  registerForm.addEventListener("submit", function (e) {
    e.preventDefault();
    const email = document.getElementById("regEmail").value;
    const password = document.getElementById("regPassword").value;
    const errorContainer = document.getElementById("registerError");
    const successContainer = document.getElementById("registerSuccess");

    fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          successContainer.textContent = "✅ Регистрация успешна! Теперь войдите в систему.";
          successContainer.style.color = "green";
          errorContainer.textContent = ""; // Очищаем ошибки
          registerForm.style.display = "none";
          toggleRegisterBtn.textContent = "Зарегистрироваться";
        } else {
          errorContainer.textContent = data.message;
          errorContainer.style.color = "red";
        }
      })
      .catch((err) => {
        errorContainer.textContent = "Ошибка сервера. Попробуйте позже.";
        errorContainer.style.color = "red";
      });
  });
}


  // Вход через Solana кошелек
  const solanaBtn = document.getElementById("solanaBtn");
  if (solanaBtn) {
    solanaBtn.addEventListener("click", async () => {
      const errorContainer = document.getElementById("solanaLoginError");
  
      if (!window.solana || !window.solana.isPhantom) {
        errorContainer.textContent = "Phantom кошелек не найден!";
        errorContainer.style.color = "red";
        return;
      }
  
      try {
        const resp = await window.solana.connect();
        const walletAddress = resp.publicKey.toString();
  
        const message = "Login to Margo on SOL. Nonce: " + Date.now();
        const encodedMessage = new TextEncoder().encode(message);
        const signed = await window.solana.signMessage(encodedMessage, "utf8");
        const signature = btoa(String.fromCharCode(...signed.signature));
  
        const response = await fetch("/api/wallet-login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ walletAddress, message, signature }),
        });
  
        const data = await response.json();
        if (data.success) {
          localStorage.setItem("userToken", data.token);
          window.location.href = "index.html";
        } else {
          errorContainer.textContent = "Ошибка: " + data.message;
          errorContainer.style.color = "red";
        }
      } catch (err) {
        errorContainer.textContent = "Ошибка подключения к кошельку: " + err.message;
        errorContainer.style.color = "red";
      }
    });
  }
  

  // Фильтрация коллекций (на collections.html)
  const filterButtons = document.querySelectorAll(".filter-btn");
  if (filterButtons) {
    filterButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const filter = btn.getAttribute("data-filter");
        filterButtons.forEach((button) => button.classList.remove("active"));
        btn.classList.add("active");
        filterCollections(filter);
      });
    });

    function filterCollections(filter) {
      const cards = document.querySelectorAll(".collection-card");
      cards.forEach((card) => {
        const category = card.getAttribute("data-category");
        if (filter === "all" || filter === category) {
          card.style.display = "block";
        } else {
          card.style.display = "none";
        }
      });
    }
  }

  // Dashboard: Drag & Drop загрузка превью
  const previewDragDropArea = document.getElementById("previewDragDropArea");
  const previewUpload = document.getElementById("previewUpload");
  const previewPreview = document.getElementById("previewPreview");
  if (previewDragDropArea) {
    previewDragDropArea.addEventListener("click", () => previewUpload.click());
    previewDragDropArea.addEventListener("dragover", (e) => {
      e.preventDefault();
      previewDragDropArea.classList.add("dragover");
    });
    previewDragDropArea.addEventListener("dragleave", () => {
      previewDragDropArea.classList.remove("dragover");
    });
    previewDragDropArea.addEventListener("drop", (e) => {
      e.preventDefault();
      previewDragDropArea.classList.remove("dragover");
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        displayPreview(files[0], previewPreview);
      }
    });
  }
  if (previewUpload) {
    previewUpload.addEventListener("change", function () {
      if (this.files.length > 0) {
        displayPreview(this.files[0], previewPreview);
      }
    });
  }
  function displayPreview(file, container) {
    const reader = new FileReader();
    reader.onload = function (e) {
      container.innerHTML = `<img src="${e.target.result}" alt="Preview Image" style="max-width:150px; max-height:150px;">`;
    };
    reader.readAsDataURL(file);
  }

  // Dashboard: Drag & Drop загрузка файлов коллекции
  const collectionDragDropArea = document.getElementById("collectionDragDropArea");
  const collectionUpload = document.getElementById("collectionUpload");
  const collectionPreview = document.getElementById("collectionPreview");
  if (collectionDragDropArea) {
    collectionDragDropArea.addEventListener("click", () => collectionUpload.click());
    collectionDragDropArea.addEventListener("dragover", (e) => {
      e.preventDefault();
      collectionDragDropArea.classList.add("dragover");
    });
    collectionDragDropArea.addEventListener("dragleave", () => {
      collectionDragDropArea.classList.remove("dragover");
    });
    collectionDragDropArea.addEventListener("drop", (e) => {
      e.preventDefault();
      collectionDragDropArea.classList.remove("dragover");
      const files = e.dataTransfer.files;
      displayMultipleFiles(files, collectionPreview);
    });
  }
  if (collectionUpload) {
    collectionUpload.addEventListener("change", function () {
      if (this.files.length > 0) {
        displayMultipleFiles(this.files, collectionPreview);
      }
    });
  }
  function displayMultipleFiles(files, container) {
    container.innerHTML = "";
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = function (e) {
        const element = document.createElement("div");
        element.innerHTML = `<img src="${e.target.result}" alt="Collection File" style="max-width:100px; max-height:100px; margin:5px;">`;
        container.appendChild(element);
      };
      reader.readAsDataURL(file);
    });
  }

  // Форма загрузки коллекции (Dashboard)
  const uploadForm = document.getElementById("uploadForm");
  if (uploadForm) {
    uploadForm.addEventListener("submit", function (e) {
      e.preventDefault();
      const title = document.getElementById("collectionTitle").value;
      const description = document.getElementById("collectionDescription").value;
      const price = document.getElementById("collectionPrice").value;
      const token = localStorage.getItem("authToken") || "";
      const formData = new FormData();
      formData.append("collectionTitle", title);
      formData.append("collectionDescription", description);
      formData.append("collectionPrice", price);
      formData.append("token", token);
      if (previewUpload.files[0]) {
        formData.append("preview", previewUpload.files[0]);
      }
      if (collectionUpload.files.length > 0) {
        Array.from(collectionUpload.files).forEach((file) => {
          formData.append("collection", file);
        });
      }
      fetch("/api/upload", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`
        },
        body: formData
      })
        .then((res) => res.json())
        .then((data) => {
          alert(data.message || "Коллекция загружена!");
          uploadForm.reset();
          previewPreview.innerHTML = "";
          collectionPreview.innerHTML = "";
          addCollectionToTable({
            title,
            description,
            price,
            views: 0,
            sales: 0,
            image: previewPreview.querySelector("img")
              ? previewPreview.querySelector("img").src
              : ""
          });
        })
        .catch((err) => console.error(err));
    });
  }

  // Функция добавления коллекции в таблицу (панель управления)
  function addCollectionToTable(collection) {
    const tableBody = document.getElementById("collectionsTable");
    if (!tableBody) return;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        ${
          collection.image
            ? `<img src="${collection.image}" alt="${collection.title}" width="50">`
            : "Нет изображения"
        }
      </td>
      <td>${collection.title}</td>
      <td>${collection.views}</td>
      <td>${collection.sales}</td>
      <td>
        <button class="btn delete-btn">Удалить</button>
      </td>
    `;
    tableBody.appendChild(tr);
    tr.querySelector(".delete-btn").addEventListener("click", () => {
      if (confirm("Вы уверены, что хотите удалить эту коллекцию?")) {
        tr.remove();
      }
    });
  }
  console.log("🔍 loadUserCollections() вызвана!");

  async function deleteCollection(id) {
    const token = localStorage.getItem("authToken");
    if (!token) return;
  
    try {
      const response = await fetch(`/api/delete-collection/${id}`, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${token}` },
      });
  
      const data = await response.json();
      if (data.success) {
        alert("Коллекция удалена!");
      } else {
        alert("Ошибка: " + data.message);
      }
    } catch (error) {
      console.error("Ошибка удаления коллекции:", error);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    console.log("📢 Страница загружена, загружаем коллекции...");
    loadUserCollections();
  });
  
  console.log("🔍 loadUserCollections() вызвана!");

  async function loadUserCollections() {
    console.log("🚀 loadUserCollections() вызвана!");
    const token = localStorage.getItem("authToken");
    if (!token) {
        console.log("❌ Токен отсутствует, пропускаем запрос.");
        return;
    }
    console.log("📨 Отправляем запрос к /api/user-collections...");

    try {
        const response = await fetch("/api/user-collections", {
            method: "GET",
            headers: { "Authorization": `Bearer ${token}` },
        });

        console.log("📩 Получен ответ от сервера:", response);
        const data = await response.json();
        console.log("📂 Декодированные данные:", data);

        if (data.success) {
            console.log("✅ Коллекции загружены:", data.collections);
            renderCollections(data.collections);
        } else {
            console.error("❌ Ошибка загрузки:", data.message);
        }
    } catch (err) {
        console.error("🔥 Ошибка запроса:", err);
    }
}

// Делаем функцию доступной в консоли
window.loadUserCollections = loadUserCollections;


  
  // Функция отрисовки коллекций на странице
  function renderCollections(collections) {
    const tableBody = document.getElementById("collectionsTable");
    if (!tableBody) return;
  
    tableBody.innerHTML = ""; // Очищаем старый список
  
    collections.forEach((collection) => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td><img src="${collection.preview}" width="50"></td>
        <td>${collection.title}</td>
        <td>${collection.views}</td>
        <td>${collection.sales}</td>
        <td>
          <button class="btn delete-btn" data-id="${collection.id}">Удалить</button>
        </td>
      `;
  
      // Добавляем обработчик удаления
      row.querySelector(".delete-btn").addEventListener("click", async () => {
        if (confirm("Вы уверены, что хотите удалить коллекцию?")) {
          await deleteCollection(collection.id);
          row.remove();
        }
      });
  
      tableBody.appendChild(row);
    });
  }
  
  // Вызов функции загрузки коллекций при загрузке страницы
  document.addEventListener("DOMContentLoaded", loadUserCollections);
  
  // Переключение кнопок в шапке (авторизация vs профиль)
  const authBtn = document.querySelector(".auth .auth-btn");
  const profileBtn = document.querySelector(".auth .profile-btn");
  if (authBtn && profileBtn) {
    const token = localStorage.getItem("authToken");
    if (token) {
      authBtn.style.display = "none";
      profileBtn.style.display = "inline-block";
    } else {
      authBtn.style.display = "inline-block";
      profileBtn.style.display = "none";
    }
  }

  const solanaWeb3 = window.solanaWeb3 || {};
const { Transaction, Connection, clusterApiUrl } = solanaWeb3;

// ======= Вспомогательная функция для декодирования base64 в Uint8Array =======
function base64ToUint8Array(base64) {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

const observer = new MutationObserver((mutationsList) => {
  mutationsList.forEach((mutation) => {
    if (mutation.type === "childList") {
      const buyButtons = document.querySelectorAll(".buy-btn");
      console.log(`🔍 Обновлено, найдено кнопок: ${buyButtons.length}`);

      buyButtons.forEach((btn) => {
        if (!btn.dataset.listenerAdded) {
          btn.addEventListener("click", handleBuyClick);
          btn.dataset.listenerAdded = "true"; // Пометка, что обработчик уже добавлен
        }
      });
    }
  });
});

// Запуск отслеживания изменений внутри body
observer.observe(document.body, { childList: true, subtree: true });
const Message = solanaWeb3.Message || solanaWeb3.TransactionMessage;


async function checkAuthorAccess() {
  // Ждем, пока перевод выполнится (до 2 сек, если потребуется)
  await new Promise(resolve => setTimeout(resolve, 500));

  const dashboardLink = document.querySelector('.nav-links a[data-i18n="navDashboard"]');

  if (!dashboardLink) {
    console.warn("⚠️ Ссылка 'Панель управления' не найдена!");
    return;
  }

  const token = localStorage.getItem("authToken");
  if (!token) {
    dashboardLink.style.display = "none"; // Скрываем, если нет токена
    return;
  }

  try {
    const response = await fetch("/api/check-author", {
      method: "GET",
      headers: { "Authorization": `Bearer ${token}` },
    });

    const data = await response.json();
    if (!data.isApproved) {
      console.log("❌ Пользователь не авторизован как автор, скрываем 'Панель управления'.");
      dashboardLink.style.display = "none"; // Скрываем ссылку
    } else {
      console.log("✅ Пользователь одобрен как автор, оставляем 'Панель управления'.");
    }
  } catch (error) {
    console.error("Ошибка проверки автора:", error);
    dashboardLink.style.display = "none"; // На случай ошибки скрываем
  }
}

// Запускаем после загрузки перевода
document.addEventListener("DOMContentLoaded", () => {
  setTimeout(checkAuthorAccess, 1000);
});


// Запускаем после загрузки страницы
document.addEventListener("DOMContentLoaded", checkAuthorAccess);


// Функция обработки покупки
// Функция обработки покупки
async function handleBuyClick(event) {
  const btn = event.target;
  let messageContainer = btn.nextElementSibling;

  // Если рядом с кнопкой отсутствует контейнер для сообщений, создаем его
  if (!messageContainer) {
    messageContainer = document.createElement("div");
    btn.parentNode.insertBefore(messageContainer, btn.nextSibling);
  }
  
  function showMessage(message, isError = true) {
    messageContainer.textContent = message;
    messageContainer.style.color = isError ? 'red' : 'green';
  }

  const token = localStorage.getItem("authToken");
  if (!token) {
    showMessage("❌ Войдите, чтобы совершить покупку.");
    return;
  }
  
  const collectionId = btn.getAttribute("data-id");
  const priceInSOL = parseFloat(btn.getAttribute("data-price")) || 0;

  if (!window.solana || !window.solana.isPhantom) {
    showMessage("❌ Установите Phantom кошелек!");
    return;
  }

  try {
    const wallet = await window.solana.connect();
    const walletAddress = wallet.publicKey.toString();

    showMessage("📤 Отправляем запрос на покупку...", false);

    if (isNaN(priceInSOL)) {
      showMessage("❌ Ошибка: Неверная цена!");
      return;
    }
    if (!window.solana.isConnected) {
      showMessage("❌ Ошибка: Кошелек отключен. Переподключите его.");
      await window.solana.connect();
    }
    
    const response = await fetch("/api/sol-purchase", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ collectionId, amount: priceInSOL, buyerWallet: walletAddress })
    });
    
    const data = await response.json();
    if (!data.success) {
      showMessage("❌ Ошибка: " + data.message);
      return;
    }

    const transactionBytes = base64ToUint8Array(data.transaction);
    let transaction;
    
    try {
      transaction = solanaWeb3.Transaction.from(transactionBytes);
      showMessage("📜 Транзакция получена.", false);
    } catch (error) {
      console.error("❌ Ошибка при разборе транзакции:", error);
      showMessage("❌ Ошибка при обработке транзакции!");
      return;
    }
    
    try {
      transaction = Transaction.from(transactionBytes);
    } catch (error) {
      console.error("❌ Ошибка при разборе транзакции:", error);
      showMessage("❌ Ошибка при обработке транзакции!");
      return;
    }
    
    // Подписываем транзакцию в Phantom
    const signedTransaction = await window.solana.signTransaction(transaction);
    showMessage("✅ Транзакция подписана.", false);
    
    // Сериализуем подписанную транзакцию
    const rawTransaction = signedTransaction.serialize();
    showMessage("📤 Отправляем подписанную транзакцию...", false);
    
    // Отправляем транзакцию в сеть Solana
    const connection = new Connection("https://mainnet.helius-rpc.com/?api-key=10fe9bff-ebe2-4760-9adb-c1d26b87bd68", "confirmed");

    let txid;
    try {
      txid = await connection.sendRawTransaction(rawTransaction, {
        skipPreflight: false,
        preflightCommitment: "processed"
      });
      showMessage(`🚀 Транзакция успешно отправлена! ID: ${txid}`, false);
    } catch (error) {
      console.error("❌ Ошибка при подписании/отправке транзакции:", error);
      showMessage("❌ Ошибка при отправке транзакции. Проверьте кошелек.");
      return;
    }
    
    // Ожидание подтверждения транзакции
    let confirmed = false;
    while (!confirmed) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      const confirmation = await connection.getTransaction(txid, { commitment: "confirmed" });
      if (confirmation) confirmed = true;
    }
    
    const checkResponse = await fetch("/api/check-payment", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ collectionId, signature: txid })
    });
    
    const checkData = await checkResponse.json();
    if (checkData.success) {
      showMessage("🎉 Покупка завершена! Доступ к коллекции предоставлен.", false);
    } else {
      showMessage("❌ Ошибка при подтверждении: " + checkData.message);
    }
  
  } catch (error) {
    console.error("❌ Ошибка при оплате:", error);
    showMessage("❌ Ошибка при оплате! Проверьте кошелек.");
  }
}

})

document.addEventListener("DOMContentLoaded", function () {
  const menuToggle = document.querySelector(".menu-toggle");
  const navLinks = document.querySelector(".nav-links");

  menuToggle.addEventListener("click", function () {
    navLinks.classList.toggle("active");
  });
});
