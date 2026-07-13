import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import AvatarDialog from '../AvatarDialog'

describe('AvatarDialog', () => {
  it('selects and saves one of four preset avatars', async () => {
    const onSave = vi.fn()
    render(<AvatarDialog open avatar="amber" onOpenChange={() => undefined} onSave={onSave} />)
    expect(screen.getAllByRole('radio')).toHaveLength(4)

    await userEvent.click(screen.getByRole('radio', { name: '海蓝' }))
    await userEvent.click(screen.getByRole('button', { name: '保存头像' }))
    expect(onSave).toHaveBeenCalledWith({ kind: 'preset', value: 'ocean' })
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
