/* Session MetaMask — Polygon Amoy */

var AMOY_PARAMS = {
  chainId: "0x13882", // 80002
  chainName: "Polygon Amoy Testnet",
  nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
  rpcUrls: ["https://rpc-amoy.polygon.technology"],
  blockExplorerUrls: ["https://amoy.polygonscan.com"]
};

// ==== Ajouter dans le jeu en mode “hard code” le nouvel Token ID ====
var TOKEN_ID = "0xd52E5f238576019248B14aAde1AAAeA11F6B7eE5";
// ========
var TOKEN_SYMBOL = "MNSC";
var TOKEN_DECIMALS = 18;

// keccak256("endGame(uint256)")[0:4]
var END_GAME_SELECTOR = "0xd0399bb8";

// Le contrat fait lui-même la mise a l'echelle en decimales : on lui passe le score brut.
function encodeEndGame(score) {
  return END_GAME_SELECTOR + BigInt(score).toString(16).padStart(64, "0");
}

function explorerTxUrl(hash) {
  return AMOY_PARAMS.blockExplorerUrls[0] + "/tx/" + hash;
}

var wallet = {
  address: null,
  chainId: null,

  isAvailable: function () {
    return typeof window.ethereum !== "undefined";
  },

  isConnected: function () {
    return this.address !== null;
  },

  isOnAmoy: function () {
    return this.chainId === AMOY_PARAMS.chainId;
  },

  // 0x1234…cdef
  short: function (addr) {
    if (!addr) return "";
    return addr.slice(0, 6) + "…" + addr.slice(-4);
  },

  // Reprend la session déjà autorisée, sans ouvrir MetaMask
  restore: async function () {
    if (!this.isAvailable()) return null;
    var accounts = await window.ethereum.request({ method: "eth_accounts" });
    this.chainId = await window.ethereum.request({ method: "eth_chainId" });
    this.address = accounts.length ? accounts[0] : null;
    renderWallet();
    return this.address;
  },

  // Ouvre MetaMask et demande l'autorisation
  connect: async function () {
    if (!this.isAvailable()) {
      renderWallet("MetaMask n'est pas installé");
      window.open("https://metamask.io/download/", "_blank");
      return null;
    }
    try {
      var accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      this.address = accounts.length ? accounts[0] : null;
      this.chainId = await window.ethereum.request({ method: "eth_chainId" });

      if (this.address && !this.isOnAmoy()) await this.switchToAmoy();

      renderWallet();
      return this.address;
    } catch (err) {
      // 4001 = l'utilisateur a refusé
      renderWallet(err.code === 4001 ? "Connexion refusée" : "Connexion impossible");
      return null;
    }
  },

  // Bascule sur Amoy, et ajoute le réseau s'il est absent de MetaMask
  switchToAmoy: async function () {
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: AMOY_PARAMS.chainId }]
      });
    } catch (err) {
      // 4902 = réseau inconnu de MetaMask
      if (err.code === 4902) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [AMOY_PARAMS]
        });
      } else {
        throw err;
      }
    }
    this.chainId = await window.ethereum.request({ method: "eth_chainId" });
    renderWallet();
  },

  // Frappe le score au joueur, 10 MNSC a l'auteur et 5 au leader precedent.
  endGame: async function (score) {
    if (!this.isOnAmoy()) await this.switchToAmoy();
    // ==== Minter le score à destination de l'adresse de session (frais de gas Amoy) ====
    var fees = await this.gasFees();
    return await window.ethereum.request({
      method: "eth_sendTransaction",
      params: [{
        from: this.address,
        to: TOKEN_ID,
        data: encodeEndGame(score),
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
        maxFeePerGas: fees.maxFeePerGas
      }]
    });
  },

  gasFees: async function () {
    var eth = window.ethereum;
    var block = await eth.request({ method: "eth_getBlockByNumber", params: ["latest", false] });
    var baseFee = BigInt(block.baseFeePerGas || "0x0");
    var tip = 30000000000n;
    try {
      var suggested = BigInt(await eth.request({ method: "eth_maxPriorityFeePerGas" })) * 5n / 4n;
      if (suggested > tip) tip = suggested;
    } catch (e) { }
    try {
      var gasPrice = BigInt(await eth.request({ method: "eth_gasPrice" }));
      if (gasPrice - baseFee > tip) tip = (gasPrice - baseFee) * 5n / 4n;
    } catch (e) { }
    var maxFee = baseFee * 2n + tip;
    console.log("gas: base", baseFee / 1000000000n, "gwei, tip", tip / 1000000000n, "gwei, max", maxFee / 1000000000n, "gwei");
    return { maxPriorityFeePerGas: "0x" + tip.toString(16), maxFeePerGas: "0x" + maxFee.toString(16) };
  },
  // ========

  // Lecture seule, sans transaction
  call: async function (selector) {
    return await window.ethereum.request({
      method: "eth_call",
      params: [{ to: TOKEN_ID, data: selector }, "latest"]
    });
  },

  leader: async function () {
    var r = await this.call("0x40eedabb"); // leader()
    if (!r || r === "0x") return null;
    var addr = "0x" + r.slice(-40);
    return /^0x0{40}$/.test(addr) ? null : addr;
  },

  highScore: async function () {
    var r = await this.call("0x1fca5278"); // highScore()
    return r && r !== "0x" ? Number(BigInt(r)) : 0;
  },

  waitForReceipt: async function (txHash) {
    for (var i = 0; i < 60; i++) {
      var receipt = await window.ethereum.request({ method: "eth_getTransactionReceipt", params: [txHash] });
      if (receipt) return receipt;
      await new Promise(function (r) { setTimeout(r, 2000); });
    }
    return null;
  },

  watchToken: async function () {
    if (!this.isAvailable()) return false;
    try {
      return await window.ethereum.request({
        method: "wallet_watchAsset",
        params: { type: "ERC20", options: { address: TOKEN_ID, symbol: TOKEN_SYMBOL, decimals: TOKEN_DECIMALS } }
      });
    } catch (err) {
      console.warn("wallet_watchAsset", err);
      return false;
    }
  }
};

/* Affichage */

function renderWallet(errorMsg) {
  var btn = document.getElementById("walletBtn");
  var status = document.getElementById("walletStatus");
  var gameOver = document.getElementById("walletAddressGameOver");

  if (!btn || !status) return;

  if (errorMsg) {
    status.textContent = errorMsg;
    status.className = "wallet-status wallet-error";
    btn.textContent = "Connecter MetaMask";
    btn.style.display = "";
  } else if (!wallet.isAvailable()) {
    status.textContent = "MetaMask n'est pas installé";
    status.className = "wallet-status wallet-error";
    btn.textContent = "Installer MetaMask";
    btn.style.display = "";
  } else if (!wallet.isConnected()) {
    status.textContent = "Aucun compte connecté";
    status.className = "wallet-status wallet-off";
    btn.textContent = "Connecter MetaMask";
    btn.style.display = "";
  } else if (!wallet.isOnAmoy()) {
    status.textContent = wallet.short(wallet.address) + " — mauvais réseau";
    status.className = "wallet-status wallet-error";
    btn.textContent = "Basculer sur Amoy";
    btn.style.display = "";
  } else {
    status.textContent = wallet.short(wallet.address);
    status.className = "wallet-status wallet-on";
    status.title = wallet.address;
    btn.style.display = "none";
  }

  if (gameOver) {
    if (wallet.isConnected() && wallet.isOnAmoy()) {
      gameOver.textContent = wallet.short(wallet.address);
      gameOver.title = wallet.address;
      gameOver.className = "wallet-status wallet-on";
    } else {
      gameOver.textContent = "connecte MetaMask pour jouer en Web3";
      gameOver.className = "wallet-status wallet-off";
    }
  }
}

/* Init */

document.addEventListener("DOMContentLoaded", function () {
  var btn = document.getElementById("walletBtn");

  if (btn) {
    btn.addEventListener("click", function () {
      if (!wallet.isAvailable()) return wallet.connect();
      if (wallet.isConnected() && !wallet.isOnAmoy()) return wallet.switchToAmoy();
      return wallet.connect();
    });
  }

  if (wallet.isAvailable()) {
    // MetaMask renvoie [] quand le compte est déverrouillé mais non autorisé
    window.ethereum.on("accountsChanged", function (accounts) {
      wallet.address = accounts.length ? accounts[0] : null;
      renderWallet();
    });

    window.ethereum.on("chainChanged", function (chainId) {
      wallet.chainId = chainId;
      renderWallet();
    });
  }

  wallet.restore();
});