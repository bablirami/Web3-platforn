const express = require("express");
const app = express();
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const { Pool } = require("pg");
require("dotenv").config();
const morgan = require("morgan");
const winston = require("winston");
const path = require("path");
const {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram
} = require("@solana/web3.js");
const nacl = require("tweetnacl");
const { TextEncoder } = require("util");
const { body, validationResult } = require("express-validator");
const crypto = require("crypto");

// ========== WINSTON ЛОГГЕР ==========
const { combine, timestamp, printf, colorize } = winston.format;
const logFormat = printf(({ level, message, timestamp }) => {
  return `${timestamp} ${level}: ${message}`;
});
const logger = winston.createLogger({
  level: "info",
  format: combine(timestamp(), logFormat),
  transports: [
    new winston.transports.File({ filename: "logs/error.log", level: "error" }),
    new winston.transports.File({ filename: "logs/combined.log" })
  ]
});
if (process.env.NODE_ENV !== "production") {
  logger.add(
    new winston.transports.Console({
      format: combine(colorize(), timestamp(), logFormat)
    })
  );
}

// ========== MORGAN для HTTP логирования ==========
app.use(
  morgan("combined", {
    stream: { write: (message) => logger.info(message.trim()) }
  })
);

// ========== ПОДКЛЮЧЕНИЕ К PostgreSQL ==========
const pool = new Pool({
  connectionString: process.env.DATABASE_URL, 
  ssl: {
    rejectUnauthorized: false
  }
});

pool.connect((err) => {
  if (err) {
    logger.error("Ошибка подключения к базе данных: " + err);
  } else {
    logger.info("Подключено к базе данных PostgreSQL");
  }
});

// ========== МИДДЛВАРЫ ==========
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Секрет для JWT
const JWT_SECRET = process.env.JWT_SECRET || "jwt_secret_key";

// Статические файлы
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Настройка Multer для загрузок
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/");
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + file.originalname;
    cb(null, uniqueSuffix);
  }
});
const upload = multer({ storage: storage });

// Маршруты для страниц
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});
app.get("/about", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "about.html"));
});
app.get("/collections", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "collections.html"));
});
app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});
app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});
app.get("/profile", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "profile.html"));
});

// ========== AUTHENTICATE TOKEN МИДДЛВАР ==========
function authenticateToken(req, res, next) {
  console.log("🔍 Заголовки запроса:", req.headers);
  
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    console.log("❌ Токен отсутствует");
    return res.status(401).json({ success: false, message: "Токен отсутствует" });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      console.log("❌ Недействительный токен:", err.message);
      return res.status(403).json({ success: false, message: "Недействительный токен" });
    }

    console.log("✅ Токен валиден! Пользователь:", user);
    req.user = user;
    next();
  });
}



// ========== API МАРШРУТЫ ==========

// Регистрация по email (через базу)
app.post("/api/register", async (req, res) => {
  const { email, password } = req.body;
  logger.info(`Тело запроса: ${JSON.stringify(req.body)}`);
  try {
    // Проверка на существование email
    const existingUser = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [email]
    );
    if (existingUser.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Пользователь с таким email уже существует."
      });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    logger.info(`Данные для вставки: ${email}, ${hashedPassword}`);
    const result = await pool.query(
      "INSERT INTO users (email, password, username) VALUES ($1, $2, $3) RETURNING id, email, username",
      [email, hashedPassword, email.split("@")[0]]
    );
    res.status(201).json({ success: true, user: result.rows[0] });
  } catch (err) {
    logger.error("Ошибка при регистрации пользователя: " + err.message);
    res
      .status(500)
      .json({ success: false, message: "Ошибка регистрации" });
  }
});

// Вход по email
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [
      email
    ]);
    if (result.rows.length === 0) {
      return res
        .status(401)
        .json({ success: false, message: "Пользователь не найден" });
    }
    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res
        .status(401)
        .json({ success: false, message: "Неверный пароль" });
    }
    const token = jwt.sign(
      { userId: user.id, email: user.email, username: user.username, wallet: user.wallet },
      JWT_SECRET,
      { expiresIn: "1d" }
    );
    res.json({ success: true, token });
  } catch (err) {
    logger.error("Ошибка при авторизации: " + err.message);
    res
      .status(500)
      .json({ success: false, message: "Ошибка авторизации" });
  }
});

// Вход через Solana кошелёк с проверкой подписи
app.post("/api/wallet-login", async (req, res) => {
  const { walletAddress, message, signature } = req.body;
  if (!walletAddress || !message || !signature) {
    return res.status(400).json({
      success: false,
      message: "walletAddress, message и signature обязательны"
    });
  }
  try {
    const publicKey = new PublicKey(walletAddress);
    const messageBytes = new TextEncoder().encode(message);
    const signatureBytes = Uint8Array.from(
      Buffer.from(signature, "base64")
    );
    const verified = nacl.sign.detached.verify(
      messageBytes,
      signatureBytes,
      publicKey.toBytes()
    );
    if (!verified) {
      return res
        .status(401)
        .json({ success: false, message: "Ошибка проверки подписи" });
    }
    // Проверка наличия пользователя с данным кошельком в БД
    let result = await pool.query("SELECT * FROM users WHERE wallet = $1", [
      walletAddress
    ]);
    let user;
    if (result.rows.length === 0) {
      const username = walletAddress.substring(0, 8);
      result = await pool.query(
        "INSERT INTO users (wallet, username) VALUES ($1, $2) RETURNING *",
        [walletAddress, username]
      );
      user = result.rows[0];
    } else {
      user = result.rows[0];
    }
    const token = jwt.sign(
      { userId: user.id, wallet: user.wallet, username: user.username },
      JWT_SECRET,
      { expiresIn: "1d" }
    );
    res.json({ success: true, token });
  } catch (err) {
    logger.error("Ошибка в /api/wallet-login: " + err.message);
    res.status(500).json({
      success: false,
      message: "Ошибка проверки подписи"
    });
  }
});

// Подключение кошелька (обновление записи пользователя)
app.post("/api/connect-wallet", authenticateToken, async (req, res) => {
  console.log("🔹 Запрос на /api/connect-wallet:", req.body);
  console.log("🔹 Пользователь:", req.user);

  const { walletAddress } = req.body;

  if (!walletAddress) {
    console.error("❌ Ошибка: Адрес кошелька не получен!");
    return res.status(400).json({ success: false, message: "Адрес кошелька обязателен" });
  }

  try {
    // Проверяем, не занят ли кошелек другим пользователем
    const existing = await pool.query("SELECT id FROM users WHERE wallet = $1 AND id != $2", [walletAddress, req.user.userId]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ success: false, message: "Этот кошелек уже привязан к другому аккаунту" });
    }

    // Обновляем запись пользователя
    const result = await pool.query(
      "UPDATE users SET wallet = $1 WHERE id = $2 RETURNING *",
      [walletAddress, req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Пользователь не найден" });
    }

    res.json({ success: true, message: "Кошелек подключен!", walletAddress });
  } catch (err) {
    console.error("Ошибка при подключении кошелька:", err);
    res.status(500).json({ success: false, message: "Ошибка подключения кошелька" });
  }
});

// Получение коллекций пользователя (созданных данным пользователем)
app.get("/api/user-collections", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM collections WHERE created_by = $1",
      [req.user.userId]
    );
    res.json({ success: true, collections: result.rows });
  } catch (err) {
    logger.error("Ошибка получения пользовательских коллекций: " + err.message);
    res.status(500).json({
      success: false,
      message: "Ошибка получения коллекций"
    });
  }
});


// Получение всех коллекций
app.get("/api/all-collections", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM collections");
    res.json({ success: true, collections: result.rows });
  } catch (err) {
    logger.error("Ошибка получения всех коллекций: " + err.message);
    res.status(500).json({
      success: false,
      message: "Ошибка получения коллекций"
    });
  }
});

// Загрузка коллекции (с использованием authenticateToken)
app.post(
  "/api/upload",
  authenticateToken,
  upload.fields([
    { name: "preview", maxCount: 1 },
    { name: "collection", maxCount: 10 }
  ]),
  async (req, res) => {
    try {
      const files = req.files;
      const { collectionTitle, collectionDescription, collectionPrice } = req.body;
      logger.info("Файлы: " + JSON.stringify(files));
      logger.info("Данные формы: " + JSON.stringify(req.body));
      if (!files || !files.preview || !files.collection) {
        return res.status(400).json({
          success: false,
          message: "Не все необходимые файлы загружены"
        });
      }
      const previewPath = `/uploads/${files.preview[0].filename}`;
      const collectionFiles = files.collection.map(
        (file) => `/uploads/${file.filename}`
      );
      const result = await pool.query(
        "INSERT INTO collections (title, description, price, preview, files, created_by, views, sales) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *",
        [
          collectionTitle,
          collectionDescription,
          parseFloat(collectionPrice),
          previewPath,
          collectionFiles,
          req.user.userId,
          0,
          0
        ]
      );
      res.status(200).json({
        success: true,
        message: "Файлы успешно загружены",
        collection: result.rows[0]
      });
    } catch (err) {
      logger.error("Ошибка загрузки коллекции: " + err.message);
      res.status(500).json({
        success: false,
        message: "Ошибка загрузки коллекции"
      });
    }
  }
);

// Покупка коллекции (оплата через стандартный механизм)
app.post(
  "/api/purchase",
  authenticateToken,
  body("collectionId")
    .isInt()
    .withMessage("ID коллекции должно быть числом"),
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res
        .status(400)
        .json({ success: false, errors: errors.array() });
    }
    try {
      const { collectionId } = req.body;
      // Проверка существования пользователя
      const userResult = await pool.query(
        "SELECT * FROM users WHERE id = $1",
        [req.user.userId]
      );
      if (userResult.rows.length === 0) {
        return res
          .status(404)
          .json({ success: false, message: "Пользователь не найден" });
      }
      // Проверка наличия коллекции
      const collectionResult = await pool.query(
        "SELECT * FROM collections WHERE id = $1",
        [collectionId]
      );
      if (collectionResult.rows.length === 0) {
        return res
          .status(404)
          .json({ success: false, message: "Коллекция не найдена" });
      }
      // Проверка, не куплена ли коллекция ранее
      const purchaseCheck = await pool.query(
        "SELECT * FROM purchases WHERE user_id = $1 AND collection_id = $2",
        [req.user.userId, collectionId]
      );
      if (purchaseCheck.rows.length > 0) {
        return res.json({
          success: true,
          message: "Коллекция уже куплена",
          accessKey: purchaseCheck.rows[0].access_key
        });
      }
      // Генерация уникального ключа доступа
      const accessKey = crypto.randomBytes(16).toString("hex");
      // Регистрация покупки
      await pool.query(
        "INSERT INTO purchases (user_id, collection_id, access_key) VALUES ($1, $2, $3)",
        [req.user.userId, collectionId, accessKey]
      );
      res.json({
        success: true,
        message: "Покупка успешна",
        accessKey: accessKey
      });
    } catch (err) {
      next(err);
    }
  }
);

app.get("/api/collections", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM collections");
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Коллекции не найдены" });
    }

    res.json({ success: true, collections: result.rows });
  } catch (err) {
    console.error("Ошибка загрузки коллекций:", err);
    res.status(500).json({ success: false, message: "Ошибка сервера" });
  }
});

// Проверка, куплена ли коллекция пользователем (возвращает флаг и, если куплена, ключ доступа)
app.get("/api/is-purchased/:collectionId", authenticateToken, async (req, res, next) => {
  try {
    const { collectionId } = req.params;
    const purchaseResult = await pool.query(
      "SELECT * FROM purchases WHERE user_id = $1 AND collection_id = $2",
      [req.user.userId, collectionId]
    );
    if (purchaseResult.rows.length > 0) {
      res.json({ purchased: true, accessKey: purchaseResult.rows[0].access_key });
    } else {
      res.json({ purchased: false });
    }
  } catch (err) {
    next(err);
  }
});

// Получение списка купленных коллекций пользователем (с информацией о коллекции и ключом доступа)
app.get("/api/my-purchases", authenticateToken, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT p.*, c.title, c.description, c.price, c.preview 
       FROM purchases p 
       JOIN collections c ON p.collection_id = c.id 
       WHERE p.user_id = $1`,
      [req.user.userId]
    );
    res.json({ success: true, purchases: result.rows });
  } catch (err) {
    next(err);
  }
});

// ========== ERROR HANDLING МИДДЛВАР ==========
function errorHandler(err, req, res, next) {
  logger.error("Ошибка: " + err.message);
  res.status(err.status || 500).json({ success: false, message: err.message });
}

app.use(errorHandler);

// === Solana-интеграция ===
// Подключение к RPC
const web3 = require("@solana/web3.js");

// 1. Просто строка-URL (GenesysGo Shadow RPC)
const SOLANA_RPC_URL = "";


// 2. Создаём подключение
const solanaConnection = new web3.Connection(SOLANA_RPC_URL, "confirmed");

(async () => {
  // 3. Проверяем, что всё работает
  console.log(await solanaConnection.getSlot());
})();



app.get("/api/balance/:walletAddress", async (req, res) => {
  const { walletAddress } = req.params;
  try {
    const publicKey = new PublicKey(walletAddress);
    const balance = await solanaConnection.getBalance(publicKey);
    res.json({ success: true, balance: balance / 1e9 }); // Переводим лампорты в SOL
  } catch (err) {
    logger.error("Ошибка получения баланса: " + err.message);
    res.status(500).json({ success: false, message: "Ошибка получения баланса" });
  }
});

app.post("/api/sol-purchase", authenticateToken, async (req, res) => {
  console.log("📩 Получен запрос на /api/sol-purchase:", req.body);
  
  const { collectionId, amount, buyerWallet } = req.body;
  if (!collectionId || !amount || !buyerWallet) {
    console.log("⚠️ Ошибка: Отсутствуют параметры!");
    return res.status(400).json({ success: false, message: "Отсутствуют параметры" });
  }

  console.log("🛠 Данные для обработки:", { collectionId, amount, buyerWallet });

  try {
    const collectionResult = await pool.query("SELECT * FROM collections WHERE id = $1", [collectionId]);
    if (collectionResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Коллекция не найдена" });
    }

    const sellerPublicKey = new PublicKey("CF6ga312fCGHNoPYp7PdNV8DHjH4giJvFSXQyQTzYJta");
    const buyerPublicKey = new PublicKey(buyerWallet);
    const lamports = amount * 1e9;

    // Получаем blockhash
    const { blockhash } = await solanaConnection.getLatestBlockhash();
    console.log("🔗 Получен recentBlockhash:", blockhash);

    let transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: buyerPublicKey,
        toPubkey: sellerPublicKey,
        lamports: lamports
      })
    );

    // Добавляем обязательные параметры
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = buyerPublicKey;

    console.log("✅ Готовая транзакция перед отправкой клиенту:", transaction);
    
    // Сериализуем транзакцию и кодируем в base64
    const serializedTransaction = transaction.serialize({ requireAllSignatures: false });
    const base64Transaction = Buffer.from(serializedTransaction).toString("base64");

    console.log("📩 Отправляем на клиент:", {
      success: true,
      message: "Транзакция создана. Подпишите её в Phantom.",
      transaction: base64Transaction
    });

    res.json({
      success: true,
      message: "Транзакция создана. Подпишите её в Phantom.",
      transaction: base64Transaction
    });

  } catch (error) {
    console.error("🔥 Ошибка обработки запроса:", error);
    res.status(500).json({ success: false, message: "Ошибка на сервере", error: error.message });
  }
});

app.post("/api/check-payment", authenticateToken, async (req, res) => {
  const { collectionId, signature } = req.body;

  if (!collectionId || !signature) {
    return res.status(400).json({ success: false, message: "Отсутствуют параметры" });
  }

  try {
    const transaction = await solanaConnection.getTransaction(signature, { commitment: "confirmed" });
    
    if (!transaction) {
      return res.status(400).json({ success: false, message: "Транзакция не найдена" });
    }

    const expectedSeller = "CF6ga312fCGHNoPYp7PdNV8DHjH4giJvFSXQyQTzYJta";
    const expectedAmount = (await pool.query("SELECT price FROM collections WHERE id = $1", [collectionId])).rows[0].price;
    
    let sender = transaction.transaction.message.accountKeys[0].toString();
    let recipient = transaction.transaction.message.accountKeys[1].toString();
    let amount = transaction.meta.postBalances[1] - transaction.meta.preBalances[1];

    if (recipient !== expectedSeller || amount !== expectedAmount * 1e9) {
      return res.status(400).json({ success: false, message: "Ошибка: некорректная сумма или получатель" });
    }

    const accessKey = crypto.randomBytes(16).toString("hex");

    await pool.query("INSERT INTO purchases (user_id, collection_id, access_key) VALUES ($1, $2, $3)", [
      req.user.userId, collectionId, accessKey
    ]);

    res.json({ success: true, message: "Оплата подтверждена", accessKey: accessKey });

  } catch (err) {
    logger.error("Ошибка проверки платежа: " + err.message);
    res.status(500).json({ success: false, message: "Ошибка проверки платежа" });
  }
});

// Дополнительный endpoint для получения информации о пользователе
app.get("/api/user-info", authenticateToken, async (req, res) => {
  try {
    console.log("Запрос к /api/user-info от пользователя:", req.user);
    const result = await pool.query("SELECT * FROM users WHERE id = $1", [req.user.userId]);
    if (result.rows.length === 0) {
      console.warn("❌ Пользователь не найден в БД!");
      return res.status(404).json({ error: "Пользователь не найден" });
    }
    res.json({
      success: true,
      username: result.rows[0].username,
      wallet: result.rows[0].wallet || "Кошелек не подключен",
      balance: result.rows[0].balance || 0
    });
  } catch (error) {
    console.error("❌ Ошибка в /api/user-info:", error);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});


app.get("/api/check-author", authenticateToken, async (req, res) => {
  try {
    const user = await pool.query("SELECT is_approved FROM users WHERE id = $1", [req.user.userId]);

    if (user.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Пользователь не найден" });
    }

    if (user.rows[0].is_approved) {
      return res.json({ success: true });
    } else {
      return res.status(403).json({ success: false, message: "Доступ запрещен" });
    }
  } catch (err) {
    console.error("Ошибка проверки авторизации:", err);
    res.status(500).json({ success: false, message: "Ошибка сервера" });
  }
});

app.delete("/api/delete-collection/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Проверяем, принадлежит ли коллекция пользователю
    const collection = await pool.query("SELECT * FROM collections WHERE id = $1 AND created_by = $2", [id, req.user.userId]);

    if (collection.rows.length === 0) {
      return res.status(403).json({ success: false, message: "Нет доступа" });
    }

    await pool.query("DELETE FROM collections WHERE id = $1", [id]);

    res.json({ success: true, message: "Коллекция удалена" });
  } catch (err) {
    console.error("Ошибка удаления:", err);
    res.status(500).json({ success: false, message: "Ошибка сервера" });
  }
});


const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🚀 Сервер запущен на порт ${port}`);
  console.log(`🌍 Доступен на: https://mar-production.up.railway.app`);

});

app.use((err, req, res, next) => {
  console.error("🔥 Ошибка на сервере:", err);
  res.status(500).json({ success: false, message: "Ошибка на сервере" });
});
