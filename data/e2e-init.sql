INSERT INTO todos (id, title, description, priority, completed, due_date, created_at, updated_at)
VALUES
    (1001, '完成品牌复评审', '确定性 E2E 示例任务', 'high', false, '2026-07-13T09:00:00+08:00', '2026-07-10T09:00:00+08:00', '2026-07-10T09:00:00+08:00'),
    (1002, '整理本周项目计划', '确定性 E2E 示例任务', 'medium', false, '2026-07-14T10:00:00+08:00', '2026-07-10T10:00:00+08:00', '2026-07-10T10:00:00+08:00'),
    (1003, '购买咖啡豆和牛奶', '确定性 E2E 示例任务', 'low', false, '2026-07-16T18:00:00+08:00', '2026-07-10T11:00:00+08:00', '2026-07-10T11:00:00+08:00'),
    (1004, '阅读 Agent 架构文档', '确定性 E2E 示例任务', 'medium', true, '2026-07-18T20:00:00+08:00', '2026-07-10T12:00:00+08:00', '2026-07-13T08:00:00+08:00')
ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    priority = EXCLUDED.priority,
    completed = EXCLUDED.completed,
    due_date = EXCLUDED.due_date,
    created_at = EXCLUDED.created_at,
    updated_at = EXCLUDED.updated_at;

SELECT setval(pg_get_serial_sequence('todos', 'id'), GREATEST((SELECT MAX(id) FROM todos), 1), true);
