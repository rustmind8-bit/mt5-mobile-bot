/**
 * metaApiService.js
 * ---------------------------------------------------------------------
 * Camada responsavel por falar com a MetaApi.cloud, que e o provedor
 * que nos permite enviar ordens para uma conta MT5 real via REST/WebSocket,
 * sem precisar instalar o terminal MetaTrader em nenhum computador.
 *
 * Documentacao oficial (verifique sempre a versao mais recente antes de ir
 * para producao, pois a SDK evolui): https://metaapi.cloud/docs/client/
 * ---------------------------------------------------------------------
 */

const MetaApi = require('metaapi.cloud-sdk').default;

const token = process.env.METAAPI_TOKEN;
if (!token) {
  console.warn('[metaApiService] AVISO: METAAPI_TOKEN nao definido no .env');
}

const api = new MetaApi(token);

let activeConnection = null;
let activeAccount = null;
let lastSyncTimestamp = null;

async function connectAccount({ login, password, server }) {
  const existingAccounts = await api.metatraderAccountApi.getAccounts();
  let account = existingAccounts.find(
    (acc) => acc.login === String(login) && acc.server === server
  );

  if (!account) {
    account = await api.metatraderAccountApi.createAccount({
      name: `bot-mobile-${login}`,
      type: 'cloud',
      login: String(login),
      password: password,
      server: server,
      platform: 'mt5',
      magic: 123456,
    });
  }

  await account.deploy();
  await account.waitConnected();

  const connection = account.getStreamingConnection();
  await connection.connect();
  await connection.waitSynchronized();

  activeConnection = connection;
  activeAccount = account;
  lastSyncTimestamp = Date.now();

  return {
    connected: true,
    accountInfo: connection.terminalState.accountInformation,
  };
}

async function disconnectAccount() {
  if (activeConnection) {
    await activeConnection.close();
  }
  activeConnection = null;
  activeAccount = null;
  lastSyncTimestamp = null;
  return { connected: false };
}

function getAccountSnapshot() {
  if (!activeConnection || !activeConnection.terminalState.connected) {
    return null;
  }
  lastSyncTimestamp = Date.now();
  const info = activeConnection.terminalState.accountInformation || {};
  const positions = activeConnection.terminalState.positions || [];

  const floatingPnL = positions.reduce((sum, p) => sum + (p.profit || 0), 0);

  return {
    balance: info.balance ?? 0,
    equity: info.equity ?? 0,
    floatingPnL,
    openPositions: positions.length,
    currency: info.currency ?? '',
    connected: true,
  };
}

function secondsSinceLastSync() {
  if (!lastSyncTimestamp) return Infinity;
  return (Date.now() - lastSyncTimestamp) / 1000;
}

async function getCurrentSpread(symbol) {
  if (!activeConnection) return null;
  const price = await activeConnection.terminalState.price(symbol);
  if (!price) return null;
  return (price.ask - price.bid) / (price.tickSize || 0.00001);
}

async function sendMarketOrder({ symbol, side, volume, stopLossPips, takeProfitPips }) {
  if (!activeConnection) throw new Error('Sem conexao ativa com o MT5.');

  const price = await activeConnection.terminalState.price(symbol);
  const pipSize = price.tickSize || 0.0001;

  const sl =
    side === 'buy'
      ? price.ask - stopLossPips * pipSize
      : price.bid + stopLossPips * pipSize;
  const tp =
    side === 'buy'
      ? price.ask + takeProfitPips * pipSize
      : price.bid - takeProfitPips * pipSize;

  const method = side === 'buy' ? 'createMarketBuyOrder' : 'createMarketSellOrder';

  return activeConnection[method](symbol, volume, sl, tp, {
    comment: 'bot-mobile',
  });
}

async function closeAllPositions() {
  if (!activeConnection) throw new Error('Sem conexao ativa com o MT5.');
  const positions = activeConnection.terminalState.positions || [];
  const results = [];
  for (const position of positions) {
    const result = await activeConnection.closePosition(position.id);
    results.push({ id: position.id, result });
  }
  return results;
}

module.exports = {
  connectAccount,
  disconnectAccount,
  getAccountSnapshot,
  secondsSinceLastSync,
  getCurrentSpread,
  sendMarketOrder,
  closeAllPositions,
};
