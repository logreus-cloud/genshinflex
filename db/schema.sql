-- Сообщения из формы обратной связи
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  kind TEXT NOT NULL,          -- data | idea | bug | other
  page TEXT,                   -- с какой страницы пришли
  message TEXT NOT NULL,
  contact TEXT,                -- необязательный контакт для ответа
  ip_hash TEXT NOT NULL,       -- хэш IP только для ограничения частоты, сам IP не храним
  status TEXT NOT NULL DEFAULT 'new'
);
CREATE INDEX IF NOT EXISTS feedback_ip_time ON feedback (ip_hash, created_at);
