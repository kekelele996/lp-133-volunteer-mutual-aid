const { Router } = require('express');
const pool = require('../../db');
const routeMessages = require('../constants/messages');
const { authenticateToken } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');

const router = Router();

router.get('/', authenticateToken, asyncHandler(async (req, res) => {
  const { other_user_id } = req.query;

  if (other_user_id) {
    const sql = `SELECT m.*, u.name as sender_name FROM messages m
      LEFT JOIN users u ON m.sender_id = u.id
      WHERE (m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?)
      ORDER BY m.created_at ASC`;
    const [rows] = await pool.query(sql, [req.user.id, other_user_id, other_user_id, req.user.id]);
    res.json({ messages: rows });
    return;
  }

  // 会话列表：必须取"每个会话时间最新的一条"作为预览，
  // 原先 MAX(content)+MAX(created_at) 是两个独立聚合，会把内容最长/字典序最大的旧消息当成最新消息。
  const sql = `SELECT
    t.other_user_id,
    u.name as other_user_name,
    t.content as last_message,
    t.created_at as last_time
    FROM (
      SELECT
        CASE WHEN m.sender_id = ? THEN m.receiver_id ELSE m.sender_id END as other_user_id,
        m.content,
        m.created_at,
        ROW_NUMBER() OVER (
          PARTITION BY CASE WHEN m.sender_id = ? THEN m.receiver_id ELSE m.sender_id END
          ORDER BY m.created_at DESC, m.id DESC
        ) as rn
      FROM messages m
      WHERE m.sender_id = ? OR m.receiver_id = ?
    ) t
    LEFT JOIN users u ON u.id = t.other_user_id
    WHERE t.rn = 1
    ORDER BY last_time DESC`;
  const [rows] = await pool.query(sql, [req.user.id, req.user.id, req.user.id, req.user.id]);
  res.json({ conversations: rows });
}));

router.post('/', authenticateToken, asyncHandler(async (req, res) => {
  const { receiver_id, content } = req.body;

  if (!receiver_id || !content) {
    return res.status(400).json({ message: routeMessages.messages.missingFields });
  }

  await pool.query(
    'INSERT INTO messages (sender_id, receiver_id, content) VALUES (?, ?, ?)',
    [req.user.id, receiver_id, content],
  );

  res.json({ message: routeMessages.messages.sent });
}));

module.exports = router;
