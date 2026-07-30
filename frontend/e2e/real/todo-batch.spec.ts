import { expect, test } from '../fixtures/app.fixture'

interface TodoRecord {
  id: number
  title: string
  completed: boolean
  priority: 'high' | 'medium' | 'low'
}

interface BatchEnvelope {
  code: number
  data: { items: TodoRecord[]; count: number }
}

test.beforeEach(async ({ login }) => { await login() })

test('@real performs atomic batch CRUD through the deployed stack', async ({ request }) => {
  const suffix = `${Date.now()}-${process.pid}`
  const titles = [0, 1, 2].map((index) => `真实批量任务 ${suffix}-${index + 1}`)

  const create = await request.post('/api/todos/batch', {
    data: { items: titles.map((title) => ({ title, priority: 'medium' })) },
  })
  expect(create.status()).toBe(201)
  const created = await create.json() as BatchEnvelope
  expect(created.data.count).toBe(3)
  expect(created.data.items.map(({ title }) => title)).toEqual(titles)
  const ids = created.data.items.map(({ id }) => id)

  const get = await request.post('/api/todos/batch/get', { data: { ids: [...ids].reverse() } })
  expect(get.ok()).toBeTruthy()
  const fetched = await get.json() as BatchEnvelope
  expect(fetched.data.items.map(({ id }) => id)).toEqual([...ids].reverse())

  const rollback = await request.put('/api/todos/batch', {
    data: { items: [{ id: ids[0], title: `${titles[0]} 不应保存` }, { id: 2_147_483_647, priority: 'high' }] },
  })
  expect(rollback.status()).toBe(404)
  await expect(rollback.json()).resolves.toMatchObject({ code: 40401 })

  const afterRollback = await request.post('/api/todos/batch/get', { data: { ids } })
  const unchanged = await afterRollback.json() as BatchEnvelope
  expect(unchanged.data.items[0]).toMatchObject({ title: titles[0], priority: 'medium' })

  const update = await request.put('/api/todos/batch', {
    data: { items: ids.map((id, index) => ({ id, title: `${titles[index]} 已更新`, priority: index === 0 ? 'high' : 'low' })) },
  })
  expect(update.ok()).toBeTruthy()
  const updated = await update.json() as BatchEnvelope
  expect(updated.data.items.map(({ priority }) => priority)).toEqual(['high', 'low', 'low'])

  const status = await request.patch('/api/todos/batch/status', { data: { ids, completed: true } })
  expect(status.ok()).toBeTruthy()
  const completed = await status.json() as BatchEnvelope
  expect(completed.data.items.every((todo) => todo.completed)).toBe(true)

  const remove = await request.delete('/api/todos/batch', { data: { ids } })
  expect(remove.ok()).toBeTruthy()
  const deleted = await remove.json() as BatchEnvelope
  expect(deleted.data.items.map(({ id }) => id)).toEqual(ids)

  const missing = await request.post('/api/todos/batch/get', { data: { ids } })
  expect(missing.status()).toBe(404)
  await expect(missing.json()).resolves.toMatchObject({ code: 40401 })
})
