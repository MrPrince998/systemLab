import type { Kind, NodeConfig } from '../engine/types'

/** Minimal, versioned design format used for share links, JSON export and saved designs. */
export interface DesignFile {
  v: 1
  nodes: { id: string; kind: Kind; x: number; y: number; config: NodeConfig }[]
  edges: [string, string][]
  mission?: string
}

const kinds: Kind[] = ['client', 'server', 'load-balancer', 'cache', 'database', 'replica', 'queue']

/** Validates untrusted input (a pasted link or an imported file) into a design, or null. */
export function parseDesign(raw: unknown): DesignFile | null {
  if (!raw || typeof raw !== 'object') return null
  const d = raw as Partial<DesignFile>
  if (d.v !== 1 || !Array.isArray(d.nodes) || !Array.isArray(d.edges)) return null
  const ids = new Set<string>()
  const nodes: DesignFile['nodes'] = []
  for (const n of d.nodes.slice(0, 200)) {
    if (!n || typeof n.id !== 'string' || !/^[\w-]{1,40}$/.test(n.id) || !kinds.includes(n.kind) || ids.has(n.id)) return null
    const config: NodeConfig = {}
    for (const [k, v] of Object.entries(n.config ?? {})) {
      if (/^\w{1,30}$/.test(k) && (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)))) config[k] = v
    }
    ids.add(n.id)
    nodes.push({ id: n.id, kind: n.kind, x: Number(n.x) || 0, y: Number(n.y) || 0, config })
  }
  const edges = d.edges.filter((e): e is [string, string] => Array.isArray(e) && ids.has(e[0]) && ids.has(e[1]) && e[0] !== e[1]).slice(0, 500)
  return { v: 1, nodes, edges, mission: typeof d.mission === 'string' ? d.mission : undefined }
}

const toBase64Url = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fromBase64Url = (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))))

export const encodeDesign = (d: DesignFile) => toBase64Url(JSON.stringify(d))

export function decodeDesign(token: string): DesignFile | null {
  try {
    return parseDesign(JSON.parse(fromBase64Url(token)))
  } catch {
    return null
  }
}
