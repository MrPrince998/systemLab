import type { DesignFile } from './store/share'

export interface User {
  id: number
  email: string
  name: string
  role: 'student' | 'teacher'
}

export interface MissionProgress {
  attempts: number
  hints: number
  completedAt?: number
}

export interface Progress {
  completed: string[]
  achievements: string[]
  missions: Record<string, MissionProgress>
}

export interface TeacherClass {
  id: number
  name: string
  code: string
  assignments: string[]
  students: { id: number; name: string; email: string; progress: Progress }[]
}

export interface StudentClass {
  id: number
  name: string
  teacher: string
  assignments: string[]
}

export interface SavedDesign {
  id: number
  name: string
  design: DesignFile
  updated_at: number
}

let token: string | null = null
try {
  token = localStorage.getItem('systemlab.token')
} catch {
  /* no storage: signed-out only */
}

export const setToken = (t: string | null) => {
  token = t
  try {
    if (t) localStorage.setItem('systemlab.token', t)
    else localStorage.removeItem('systemlab.token')
  } catch {
    /* ignore */
  }
}
export const hasToken = () => !!token

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, 'Can’t reach the server. Start it with `npm run server`.')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `Request failed (${res.status})`)
  return data as T
}

export const api = {
  health: () => call<{ ok: boolean; ai: boolean }>('GET', '/health'),
  signup: (b: { email: string; password: string; name: string; role: User['role']; progress: Progress }) => call<{ token: string; user: User }>('POST', '/auth/signup', b),
  login: (b: { email: string; password: string }) => call<{ token: string; user: User }>('POST', '/auth/login', b),
  logout: () => call('POST', '/auth/logout'),
  me: () => call<{ user: User }>('GET', '/me'),
  pushProgress: (p: Progress) => call<Progress>('PUT', '/progress', p),
  designs: () => call<SavedDesign[]>('GET', '/designs'),
  saveDesign: (name: string, design: DesignFile) => call<{ id: number }>('POST', '/designs', { name, design }),
  deleteDesign: (id: number) => call('DELETE', `/designs/${id}`),
  classes: <T extends TeacherClass | StudentClass>() => call<T[]>('GET', '/classes'),
  createClass: (name: string) => call<{ id: number; name: string; code: string }>('POST', '/classes', { name }),
  joinClass: (code: string) => call<{ id: number; name: string }>('POST', '/classes/join', { code }),
  assign: (id: number, missionIds: string[]) => call('PUT', `/classes/${id}/assignments`, { missionIds }),
  tutor: (messages: { role: 'user' | 'assistant'; content: string }[], context: string) => call<{ reply: string }>('POST', '/tutor', { messages, context }),
}
