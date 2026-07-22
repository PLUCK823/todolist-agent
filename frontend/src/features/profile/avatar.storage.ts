import type { AvatarValue } from '../auth/auth.types'

const DB_NAME = 'todolist-profile'
const STORE_NAME = 'avatars'
const memoryBlobs = new Map<string, Blob>()
const memoryPreferences = new Map<string, AvatarValue>()

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('无法打开头像存储'))
  })
}

export async function persistAvatarFile(file: File): Promise<AvatarValue> {
  if (!['image/png', 'image/jpeg'].includes(file.type)) throw new Error('仅支持 PNG 或 JPEG 图片')
  if (file.size > 5 * 1024 * 1024) throw new Error('图片不能超过 5MB')
  const key = `avatar:${crypto.randomUUID()}`
  const bytes = await file.arrayBuffer()
  const blob = new Blob([bytes], { type: file.type })
  const database = await openDatabase()
  if (!database) memoryBlobs.set(key, blob)
  else await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).put({ bytes, type: file.type }, key)
    transaction.oncomplete = () => { database.close(); resolve() }
    transaction.onerror = () => { database.close(); reject(transaction.error ?? new Error('头像存储失败')) }
    transaction.onabort = transaction.onerror
  })
  return { kind: 'blob', value: key }
}

export async function getAvatarBlob(key: string): Promise<Blob | null> {
  const database = await openDatabase()
  if (!database) return memoryBlobs.get(key) ?? null
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE_NAME).objectStore(STORE_NAME).get(key)
    request.onsuccess = () => {
      database.close()
      const stored = request.result as Blob | { bytes?: ArrayBuffer; type?: string } | undefined
      if (stored instanceof Blob) resolve(stored)
      else if (stored?.bytes instanceof ArrayBuffer) resolve(new Blob([stored.bytes], { type: stored.type }))
      else resolve(null)
    }
    request.onerror = () => { database.close(); reject(request.error ?? new Error('读取头像失败')) }
  })
}

export async function deleteAvatarBlob(key: string): Promise<void> {
  const database = await openDatabase()
  if (!database) {
    memoryBlobs.delete(key)
    return
  }
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).delete(key)
    transaction.oncomplete = () => { database.close(); resolve() }
    transaction.onerror = () => { database.close(); reject(transaction.error ?? new Error('头像清理失败')) }
    transaction.onabort = transaction.onerror
  })
}

export async function persistAvatarPreference(accountId: string, avatar: AvatarValue): Promise<void> {
  const key = `preference:${accountId}`
  const database = await openDatabase()
  if (!database) {
    memoryPreferences.set(key, avatar)
    return
  }
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).put(avatar, key)
    transaction.oncomplete = () => { database.close(); resolve() }
    transaction.onerror = () => { database.close(); reject(transaction.error ?? new Error('头像偏好存储失败')) }
    transaction.onabort = transaction.onerror
  })
}

export async function getAvatarPreference(accountId: string): Promise<AvatarValue | null> {
  const key = `preference:${accountId}`
  const database = await openDatabase()
  if (!database) return memoryPreferences.get(key) ?? null
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE_NAME).objectStore(STORE_NAME).get(key)
    request.onsuccess = () => {
      database.close()
      resolve((request.result as AvatarValue | undefined) ?? null)
    }
    request.onerror = () => { database.close(); reject(request.error ?? new Error('读取头像偏好失败')) }
  })
}
