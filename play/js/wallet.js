/* Session MetaMask — Polygon Amoy */

var AMOY_PARAMS = {
  chainId: "0x13882", // 80002
  chainName: "Polygon Amoy Testnet",
  nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
  rpcUrls: ["https://rpc-amoy.polygon.technology"],
  blockExplorerUrls: ["https://amoy.polygonscan.com"]
};

var TOKEN_ID = "0xc97dc948F4e1ced7a0Fc953Bb61Df6c5fCDAA4dd";
var TOKEN_SYMBOL = "MNSC";
var TOKEN_DECIMALS = 18;

var MINT_SELECTOR = "0x40c10f19";

function encodeMint(recipient, score) {
  var amount = BigInt(score) * (10n ** BigInt(TOKEN_DECIMALS));
  var addr = recipient.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  var amt = amount.toString(16).padStart(64, "0");
  return MINT_SELECTOR + addr + amt;
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

  mintScore: async function (recipient, score) {
    if (!this.isOnAmoy()) await this.switchToAmoy();
    var block = await window.ethereum.request({ method: "eth_getBlockByNumber", params: ["latest", false] });
    var baseFee = BigInt(block.baseFeePerGas || "0x0");
    var priorityFee = 30000000000n;
    var maxFee = baseFee * 2n + priorityFee;
    return await window.ethereum.request({
      method: "eth_sendTransaction",
      params: [{
        from: this.address,
        to: TOKEN_ID,
        data: encodeMint(recipient, score),
        maxPriorityFeePerGas: "0x" + priorityFee.toString(16),
        maxFeePerGas: "0x" + maxFee.toString(16)
      }]
    });
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