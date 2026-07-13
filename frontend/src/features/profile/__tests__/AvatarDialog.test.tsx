import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import AvatarDialog from '../AvatarDialog'
import type { AvatarValue } from '../../auth/auth.types'
import { deleteAvatarBlob, getAvatarBlob, persistAvatarFile } from '../avatar.storage'

describe('AvatarDialog', () => {
  it('selects and saves one of four preset avatars', async () => {
    const onSave = vi.fn()
    render(<AvatarDialog open avatar="amber" onOpenChange={() => undefined} onSave={onSave} />)
    expect(screen.getAllByRole('radio')).toHaveLength(4)

    await userEvent.click(screen.getByRole('radio', { name: '海蓝' }))
    await userEvent.click(screen.getByRole('button', { name: '保存头像' }))
    expect(onSave).toHaveBeenCalledWith({ kind: 'preset', value: 'ocean' })
  })

  it('keeps the dialog open and reports an asynchronous save failure', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('quota failed'))
    render(<AvatarDialog open avatar="amber" onOpenChange={() => undefined} onSave={onSave} />)
    await userEvent.click(screen.getByRole('radio', { name: '海蓝' }))
    await userEvent.click(screen.getByRole('button', { name: '保存头像' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('头像保存失败')
    expect(screen.getByRole('dialog', { name: '更换头像' })).toBeInTheDocument()
  })

  it('persists a file at the 5MB boundary without putting Base64 in localStorage', async () => {
    localStorage.clear()
    const file = new File([new Uint8Array(5 * 1024 * 1024)], 'avatar.png', { type: 'image/png' })
    const avatar = await persistAvatarFile(file)
    expect(avatar).toMatchObject({ kind: 'blob' })
    expect(JSON.stringify(localStorage)).not.toContain('data:image')
  })

  it('deletes a stored avatar explicitly', async () => {
    const avatar = await persistAvatarFile(new File(['old'], 'old.png', { type: 'image/png' }))
    expect(avatar.kind).toBe('blob')
    if (avatar.kind !== 'blob') return
    expect(await getAvatarBlob(avatar.value)).toBeInstanceOf(Blob)
    await deleteAvatarBlob(avatar.value)
    expect(await getAvatarBlob(avatar.value)).toBeNull()
  })

  it('deletes the previous blob only after a preset is saved successfully', async () => {
    const oldAvatar = await persistAvatarFile(new File(['old'], 'old.png', { type: 'image/png' }))
    if (oldAvatar.kind !== 'blob') return
    render(<AvatarDialog open avatar={oldAvatar} onOpenChange={() => undefined} onSave={() => Promise.resolve()} />)
    await userEvent.click(screen.getByRole('radio', { name: '海蓝' }))
    await userEvent.click(screen.getByRole('button', { name: '保存头像' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '保存头像' })).toBeEnabled())
    expect(await getAvatarBlob(oldAvatar.value)).toBeNull()
  })

  it('rolls back a new blob and retains the referenced old blob when profile persistence fails', async () => {
    const oldAvatar = await persistAvatarFile(new File(['old'], 'old.png', { type: 'image/png' }))
    if (oldAvatar.kind !== 'blob') return
    let attempted: AvatarValue | undefined
    const onSave = vi.fn(async (value: AvatarValue) => { attempted = value; throw new Error('profile failed') })
    render(<AvatarDialog open avatar={oldAvatar} onOpenChange={() => undefined} onSave={onSave} />)
    await userEvent.upload(screen.getByLabelText('上传头像'), new File(['new'], 'new.png', { type: 'image/png' }))
    await userEvent.click(screen.getByRole('button', { name: '保存头像' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('头像保存失败')
    expect(await getAvatarBlob(oldAvatar.value)).toBeInstanceOf(Blob)
    expect(attempted?.kind).toBe('blob')
    if (attempted?.kind === 'blob') expect(await getAvatarBlob(attempted.value)).toBeNull()
  })

  it('keeps the newly referenced blob and removes the replaced blob after upload succeeds', async () => {
    const oldAvatar = await persistAvatarFile(new File(['old'], 'old.png', { type: 'image/png' }))
    if (oldAvatar.kind !== 'blob') return
    let saved: AvatarValue | undefined
    render(<AvatarDialog open avatar={oldAvatar} onOpenChange={() => undefined} onSave={async (value) => { saved = value }} />)
    await userEvent.upload(screen.getByLabelText('上传头像'), new File(['new'], 'new.png', { type: 'image/png' }))
    await userEvent.click(screen.getByRole('button', { name: '保存头像' }))
    await waitFor(() => expect(saved?.kind).toBe('blob'))
    expect(await getAvatarBlob(oldAvatar.value)).toBeNull()
    if (saved?.kind === 'blob') expect(await getAvatarBlob(saved.value)).toBeInstanceOf(Blob)
  })

  it('rejects files that are not PNG/JPEG or exceed 5MB', async () => {
    render(<AvatarDialog open avatar="amber" onOpenChange={() => undefined} onSave={() => undefined} />)
    const input = screen.getByLabelText('上传头像')
    await userEvent.upload(input, new File(['bad'], 'avatar.gif', { type: 'image/gif' }), { applyAccept: false })
    expect(screen.getByRole('alert')).toHaveTextContent('仅支持 PNG 或 JPEG 图片')

    await userEvent.upload(input, new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }))
    expect(screen.getByRole('alert')).toHaveTextContent('图片不能超过 5MB')
  })

  it('creates an object URL for upload preview and revokes it when closed', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:avatar')
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const { rerender } = render(<AvatarDialog open avatar="amber" onOpenChange={() => undefined} onSave={() => undefined} />)
    await userEvent.upload(screen.getByLabelText('上传头像'), new File(['image'], 'avatar.png', { type: 'image/png' }))
    expect(createObjectURL).toHaveBeenCalledOnce()

    rerender(<AvatarDialog open={false} avatar="amber" onOpenChange={() => undefined} onSave={() => undefined} />)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:avatar')
  })
})
