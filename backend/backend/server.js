require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const botRoutes = require('./routes/botRoutes');

const app = express();

app.use(helmet());
app.use(express.json());
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGIN || '*',
  })
);

// Protege contra abuso/forca bruta no login e nas ordens
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60, // 60 requisicoes por minuto por IP - suficiente para polling do painel
});
app.use('/api', limiter);

app.get('/', (req, res) => {
  res.json({ status: 'online', servico: 'MT5 Mobile Bot - backend' });
});

app.use('/api', botRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor do bot a correr na porta ${PORT}`);
});
