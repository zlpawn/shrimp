import http from 'node:http';
import express from 'express';
import { cancelOrder } from './orders.js';

const router = express.Router();
router.post('/orders/:id/cancel', cancelOrder);

http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/internal/orders/reconcile') {
    res.end('accepted');
  }
});
