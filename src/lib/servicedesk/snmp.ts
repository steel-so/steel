import {
  AuthProtocols,
  createSession,
  createV3Session,
  isVarbindError,
  PrivProtocols,
  SecurityLevel,
  Version2c,
  Version3,
} from 'net-snmp'
import { normalizeMac } from './inventory'

/**
 * Varredura SNMP (v2c ou v3) para o inventário (S1). A sessão fica atrás de uma
 * interface mínima ({@link SnmpSession}) para os testes não abrirem rede, e a
 * coleta de um host ({@link collectSnmpHost}) só usa MIBs padrão — HOST-
 * RESOURCES (memória, discos, software), MIB-II (nome, interfaces) e
 * ENTITY (serial/modelo, quando o equipamento expõe).
 */

export interface SnmpVarbind {
  oid: string
  value: unknown
  isError: boolean
}

export interface SnmpSession {
  get(oids: string[]): Promise<SnmpVarbind[]>
  /** Todas as folhas abaixo do OID, até `limit`. */
  subtree(oid: string, limit?: number): Promise<SnmpVarbind[]>
  close(): void
}

export type SnmpAuthProtocolName =
  | 'MD5'
  | 'SHA'
  | 'SHA224'
  | 'SHA256'
  | 'SHA384'
  | 'SHA512'
export type SnmpPrivProtocolName = 'DES' | 'AES' | 'AES256B' | 'AES256R'

/**
 * Credenciais SNMPv3 (USM). O nível de segurança sai do que foi informado:
 * chave de privacidade → authPriv; só chave de autenticação → authNoPriv;
 * nenhuma → noAuthNoPriv.
 */
export interface SnmpV3Credentials {
  username: string
  authProtocol?: SnmpAuthProtocolName | null
  authKey?: string | null
  privProtocol?: SnmpPrivProtocolName | null
  privKey?: string | null
}

export interface SnmpSessionOptions {
  /** v2c. Ignorada quando `v3` vem preenchido. */
  community: string
  port: number
  timeoutMs: number
  v3?: SnmpV3Credentials
}

export type SnmpSessionFactory = (
  host: string,
  options: SnmpSessionOptions,
) => SnmpSession

export interface SnmpDisk {
  mount: string
  totalMb: number
  usedMb: number
}

export interface SnmpHostInfo {
  ip: string
  hostname: string
  description: string | null
  manufacturer: string | null
  model: string | null
  serialNumber: string | null
  ramTotalMb: number | null
  ramUsedMb: number | null
  macAddresses: string[]
  disks: SnmpDisk[]
  software: string[]
}

const OID = {
  sysDescr: '1.3.6.1.2.1.1.1.0',
  sysName: '1.3.6.1.2.1.1.5.0',
  hrStorageType: '1.3.6.1.2.1.25.2.3.1.2',
  hrStorageDescr: '1.3.6.1.2.1.25.2.3.1.3',
  hrStorageUnits: '1.3.6.1.2.1.25.2.3.1.4',
  hrStorageSize: '1.3.6.1.2.1.25.2.3.1.5',
  hrStorageUsed: '1.3.6.1.2.1.25.2.3.1.6',
  hrSwName: '1.3.6.1.2.1.25.6.3.1.2',
  ifPhysAddress: '1.3.6.1.2.1.2.2.1.6',
  entMfg: '1.3.6.1.2.1.47.1.1.1.1.12',
  entModel: '1.3.6.1.2.1.47.1.1.1.1.13',
  entSerial: '1.3.6.1.2.1.47.1.1.1.1.11',
} as const

const STORAGE_FIXED_DISK = '1.3.6.1.2.1.25.2.1.4'
const STORAGE_RAM = '1.3.6.1.2.1.25.2.1.2'
const MAX_SOFTWARE = 500

function asText(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const text = Buffer.isBuffer(value) ? value.toString('utf8') : String(value)
  // biome-ignore lint/suspicious/noControlCharactersInRegex: SNMP strings carry NUL padding
  const clean = text.replace(/[\u0000-\u001f]/g, ' ').trim()
  return clean === '' ? null : clean
}

function asNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(asText(value))
  return Number.isFinite(n) ? n : null
}

function asMac(value: unknown): string | null {
  if (Buffer.isBuffer(value)) return normalizeMac(value.toString('hex'))
  const text = asText(value)
  return text ? normalizeMac(text) : null
}

/** Último índice do OID (a linha da tabela). */
function rowIndex(oid: string): string {
  return oid.slice(oid.lastIndexOf('.') + 1)
}

function indexed(rows: SnmpVarbind[]): Map<string, unknown> {
  const out = new Map<string, unknown>()
  for (const row of rows) {
    if (!row.isError) out.set(rowIndex(row.oid), row.value)
  }
  return out
}

function firstText(rows: SnmpVarbind[]): string | null {
  for (const row of rows) {
    if (row.isError) continue
    const text = asText(row.value)
    if (text) return text
  }
  return null
}

/**
 * Lê um host. `null` quando ele não responde ao SNMP (a varredura passa
 * pelos endereços sem equipamento sem tratar como erro). Falhas parciais
 * (uma MIB que o equipamento não implementa) só deixam o campo vazio.
 */
export async function collectSnmpHost(
  session: SnmpSession,
  ip: string,
): Promise<SnmpHostInfo | null> {
  let head: SnmpVarbind[]
  try {
    head = await session.get([OID.sysDescr, OID.sysName])
  } catch {
    return null
  }
  const description = head[0] && !head[0].isError ? asText(head[0].value) : null
  const sysName = head[1] && !head[1].isError ? asText(head[1].value) : null
  if (!description && !sysName) return null

  const safe = async (oid: string, limit?: number): Promise<SnmpVarbind[]> => {
    try {
      return await session.subtree(oid, limit)
    } catch {
      return []
    }
  }

  const [types, descrs, units, sizes, used, swNames, macs, mfg, model, serial] =
    await Promise.all([
      safe(OID.hrStorageType),
      safe(OID.hrStorageDescr),
      safe(OID.hrStorageUnits),
      safe(OID.hrStorageSize),
      safe(OID.hrStorageUsed),
      safe(OID.hrSwName, MAX_SOFTWARE),
      safe(OID.ifPhysAddress),
      safe(OID.entMfg, 8),
      safe(OID.entModel, 8),
      safe(OID.entSerial, 8),
    ])

  const typeBy = indexed(types)
  const descrBy = indexed(descrs)
  const unitsBy = indexed(units)
  const sizeBy = indexed(sizes)
  const usedBy = indexed(used)

  const disks: SnmpDisk[] = []
  let ramTotalMb: number | null = null
  let ramUsedMb: number | null = null

  for (const [index, type] of typeBy) {
    const kind = String(type)
    const unit = asNumber(unitsBy.get(index))
    const size = asNumber(sizeBy.get(index))
    const inUse = asNumber(usedBy.get(index))
    if (!unit || size === null || inUse === null) continue
    const totalMb = Math.round((size * unit) / 1_048_576)
    const usedMb = Math.round((inUse * unit) / 1_048_576)
    if (kind.endsWith(STORAGE_FIXED_DISK) && totalMb > 0) {
      disks.push({
        mount: asText(descrBy.get(index)) ?? `volume-${index}`,
        totalMb,
        usedMb,
      })
    } else if (kind.endsWith(STORAGE_RAM) && totalMb > 0) {
      ramTotalMb = totalMb
      ramUsedMb = usedMb
    }
  }

  const macAddresses = [
    ...new Set(
      macs
        .map((row) => (row.isError ? null : asMac(row.value)))
        .filter((mac): mac is string => mac !== null),
    ),
  ]

  const software = [
    ...new Set(
      swNames
        .map((row) => (row.isError ? null : asText(row.value)))
        .filter((name): name is string => name !== null),
    ),
  ]

  return {
    ip,
    hostname: sysName ?? ip,
    description,
    manufacturer: firstText(mfg),
    model: firstText(model),
    serialNumber: firstText(serial),
    ramTotalMb,
    ramUsedMb,
    macAddresses,
    disks,
    software,
  }
}

export interface SnmpScanResult {
  found: SnmpHostInfo[]
  probed: number
  failed: number
}

/**
 * Varre os endereços com concorrência limitada. Um host que não responde não
 * é falha; falha é a sessão estourar fora do SNMP (`failed`).
 */
export async function scanSnmpHosts(
  hosts: string[],
  factory: SnmpSessionFactory,
  options: SnmpSessionOptions & { concurrency?: number },
): Promise<SnmpScanResult> {
  const found: SnmpHostInfo[] = []
  let failed = 0
  let cursor = 0
  const workers = Math.max(1, Math.min(options.concurrency ?? 32, hosts.length))

  const run = async () => {
    while (cursor < hosts.length) {
      const host = hosts[cursor++] as string
      let session: SnmpSession | null = null
      try {
        session = factory(host, options)
        const info = await collectSnmpHost(session, host)
        if (info) found.push(info)
      } catch {
        failed++
      } finally {
        session?.close()
      }
    }
  }

  await Promise.all(Array.from({ length: workers }, run))
  return { found, probed: hosts.length, failed }
}

const AUTH_PROTOCOLS: Record<SnmpAuthProtocolName, AuthProtocols> = {
  MD5: AuthProtocols.md5,
  SHA: AuthProtocols.sha,
  SHA224: AuthProtocols.sha224,
  SHA256: AuthProtocols.sha256,
  SHA384: AuthProtocols.sha384,
  SHA512: AuthProtocols.sha512,
}

const PRIV_PROTOCOLS: Record<SnmpPrivProtocolName, PrivProtocols> = {
  DES: PrivProtocols.des,
  AES: PrivProtocols.aes,
  AES256B: PrivProtocols.aes256b,
  AES256R: PrivProtocols.aes256r,
}

/** Usuário USM do `net-snmp` a partir das credenciais guardadas. */
export function buildSnmpV3User(credentials: SnmpV3Credentials) {
  const authenticated = !!credentials.authKey
  const encrypted = authenticated && !!credentials.privKey
  return {
    name: credentials.username,
    level: encrypted
      ? SecurityLevel.authPriv
      : authenticated
        ? SecurityLevel.authNoPriv
        : SecurityLevel.noAuthNoPriv,
    ...(authenticated
      ? {
          authProtocol: AUTH_PROTOCOLS[credentials.authProtocol ?? 'SHA'],
          authKey: credentials.authKey as string,
        }
      : {}),
    ...(encrypted
      ? {
          privProtocol: PRIV_PROTOCOLS[credentials.privProtocol ?? 'AES'],
          privKey: credentials.privKey as string,
        }
      : {}),
  }
}

/** Fábrica real, sobre o `net-snmp` (v2c ou v3, sem retry: o timeout já basta). */
export const createNetSnmpSession: SnmpSessionFactory = (host, options) => {
  const session = options.v3
    ? createV3Session(host, buildSnmpV3User(options.v3), {
        port: options.port,
        retries: 0,
        timeout: options.timeoutMs,
        version: Version3,
      })
    : createSession(host, options.community, {
        port: options.port,
        retries: 0,
        timeout: options.timeoutMs,
        version: Version2c,
      })
  // Sem este handler, um erro de socket derruba o processo do worker.
  session.on('error', () => {})

  return {
    get: (oids) =>
      new Promise((resolve, reject) => {
        session.get(oids, (error, varbinds) => {
          if (error) return reject(error)
          resolve(
            (varbinds ?? []).map((vb) => ({
              oid: vb.oid,
              value: vb.value,
              isError: isVarbindError(vb),
            })),
          )
        })
      }),
    subtree: (oid, limit = 2000) =>
      new Promise((resolve, reject) => {
        const rows: SnmpVarbind[] = []
        session.subtree(
          oid,
          20,
          (varbinds) => {
            for (const vb of varbinds ?? []) {
              if (rows.length < limit) {
                rows.push({
                  oid: vb.oid,
                  value: vb.value,
                  isError: isVarbindError(vb),
                })
              }
            }
          },
          (error) => (error ? reject(error) : resolve(rows)),
        )
      }),
    close: () => session.close(),
  }
}
