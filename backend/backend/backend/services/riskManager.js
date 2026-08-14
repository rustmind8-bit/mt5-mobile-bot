/**
 * riskManager.js
 * ---------------------------------------------------------------------
 * Todas as regras de protecao da conta REAL vivem aqui e sao avaliadas
 * no SERVIDOR, nunca so no telemovel.
 * ---------------------------------------------------------------------
 */

const metaApiService = require('./metaApiService');

const state = {
  botLigado: false,
  config: {
    lote: 0.01,
    dailyStopLossValor: 50,
    spreadMaximoPontos: 30,
    symbol: 'EURUSD',
    stopLossPips: 200,
    takeProfitPips: 400,
  },
  saldoInicioDoDia: null,
  dataDoUltimoReset: null,
  travaDeSeguranca: false,
  alertas: [],
};

function registrarAlerta(mensagem) {
  state.alertas.unshift({ mensagem, timestamp: new Date().toISOString() });
  state.alertas = state.alertas.slice(0, 20);
}

function resetDiarioSeNecessario(saldoAtual) {
  const hoje = new Date().toISOString().slice(0, 10);
  if (state.dataDoUltimoReset !== hoje) {
    state.saldoInicioDoDia = saldoAtual;
    state.dataDoUltimoReset = hoje;
  }
}

function limiteDePerdaDiariaAtingido(saldoAtual, equityAtual) {
  if (state.saldoInicioDoDia === null) return false;
  const perdaDoDia = state.saldoInicioDoDia - equityAtual;
  return perdaDoDia >= state.config.dailyStopLossValor;
}

async function spreadAbusivo(symbol) {
  const spreadAtual = await metaApiService.getCurrentSpread(symbol);
  if (spreadAtual === null) return false;
  return spreadAtual > state.config.spreadMaximoPontos;
}

function verificarConexao() {
  const segundos = metaApiService.secondsSinceLastSync();
  if (segundos > 30 && state.botLigado) {
    if (!state.travaDeSeguranca) {
      state.travaDeSeguranca = true;
      registrarAlerta(
        'Conexao com o MT5 perdida ha mais de 30s. Novas ordens bloqueadas.'
      );
    }
  } else {
    state.travaDeSeguranca = false;
  }
  return state.travaDeSeguranca;
}

async function podeAbrirOrdem() {
  if (!state.botLigado) {
    return { permitido: false, motivo: 'Bot desligado.' };
  }

  if (verificarConexao()) {
    return {
      permitido: false,
      motivo: 'Trava de seguranca ativa: sem conexao ha mais de 30s.',
    };
  }

  const snapshot = metaApiService.getAccountSnapshot();
  if (!snapshot) {
    return { permitido: false, motivo: 'Sem dados de conta disponiveis.' };
  }

  resetDiarioSeNecessario(snapshot.balance);

  if (limiteDePerdaDiariaAtingido(snapshot.balance, snapshot.equity)) {
    if (state.botLigado) {
      registrarAlerta('Limite de perda diaria atingido. Bot desligado automaticamente.');
    }
    state.botLigado = false;
    return { permitido: false, motivo: 'Limite de perda diaria atingido.' };
  }

  if (await spreadAbusivo(state.config.symbol)) {
    return { permitido: false, motivo: 'Spread acima do limite configurado.' };
  }

  return { permitido: true };
}

function ligarBot() {
  state.botLigado = true;
  registrarAlerta('Bot ligado pelo painel mobile.');
}

function desligarBot() {
  state.botLigado = false;
  registrarAlerta('Bot desligado pelo painel mobile.');
}

function atualizarConfig(novaConfig) {
  state.config = { ...state.config, ...novaConfig };
}

function getEstado() {
  return {
    botLigado: state.botLigado,
    config: state.config,
    travaDeSeguranca: state.travaDeSeguranca,
    saldoInicioDoDia: state.saldoInicioDoDia,
    alertas: state.alertas,
  };
}

module.exports = {
  podeAbrirOrdem,
  ligarBot,
  desligarBot,
  atualizarConfig,
  getEstado,
  verificarConexao,
  registrarAlerta,
};
