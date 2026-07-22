export type AvatarPreset = 'amber' | 'ocean' | 'forest' | 'violet'

export type AvatarValue =
  | { kind: 'preset'; value: AvatarPreset }
  | { kind: 'image'; value: string }
  | { kind: 'blob'; value: string }

export interface Account {
  id: string
  name: string
  email: string
  timezone: string
  avatar: AvatarValue
  taskCount: number
  agentSessionCount: number
}

export interface Session {
  account: Account
}

export interface RegisterInput {
  name: string
  email: string
  password: string
}

export interface LoginInput {
  email: string
  password: string
}

export type ProfileUpdate = Partial<Pick<Account, 'name' | 'email' | 'timezone' | 'avatar'>>

export interface AuthApi {
  register(input: RegisterInput): Promise<Account>
  login(input: LoginInput): Promise<Account>
  logout(): Promise<void>
  getSession(): Promise<Session | null>
  updateProfile(input: ProfileUpdate): Promise<Account>
}
