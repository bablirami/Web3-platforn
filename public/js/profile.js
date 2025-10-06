document.addEventListener("DOMContentLoaded", () => {
    const walletBtn = document.getElementById("connectWallet");
    const walletAddressEl = document.querySelector("#walletAddress span");
    const logoutBtn = document.getElementById("logoutBtn");
  
    const token = localStorage.getItem("userToken");
    if (!token) {
      alert("Сначала выполните вход!");
      window.location.href = "login.html";
      return;
    }
    
    const tokenPayload = JSON.parse(atob(token.split(".")[1]));
    // Если пользователь зарегистрирован по email, отображаем email; иначе – username (первые 8 символов)
    const displayName = tokenPayload.email ? tokenPayload.email : tokenPayload.username;
    document.getElementById("userEmail").textContent = displayName;
  
    walletBtn.addEventListener("click", async () => {
        const walletAddress = prompt("Введите адрес кошелька Solana:");
        if (walletAddress) {
          walletAddressEl.textContent = walletAddress;
          alert("Кошелек подключен!");
          fetch("/api/connect-wallet", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({ walletAddress })
          }).catch(console.error);
        }
      });
  
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      localStorage.removeItem("userToken");
      window.location.href = "login.html";
    });
  }
  
    fetch("/api/collections", {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => {
        const collectionsList = document.getElementById("collectionsList");
        data.collections.forEach(collection => {
          const li = document.createElement("li");
          li.textContent = `${collection.title} - ${collection.price} SOL`;
          collectionsList.appendChild(li);
        });
      })
      .catch(console.error);
  });
  