import { createVerify } from 'crypto'

export interface DiscordEmbed {
  title?: string
  description?: string
  color?: number
  fields?: Array<{ name: string; value: string; inline?: boolean }>
  footer?: { text: string }
  timestamp?: string
}

export interface DiscordInteraction {
  type: number
  token: string
  data?: { name: string; options?: Array<{ name: string; value: unknown }> }
  guild_id?: string
  channel_id?: string
  member?: { user: { id: string; username: string } }
  user?: { id: string; username: string }
}

export const COLORS = {
  green: 0x57f287,
  blue: 0x5865f2,
  yellow: 0xfee75c,
  red: 0xed4245,
  purple: 0x9b59b6,
} as const

export function verifyDiscordSignature(
  publicKey: string,
  signature: string,
  timestamp: string,
  rawBody: string
): boolean {
  try {
    const verifier = createVerify('Ed25519')
    verifier.update(timestamp + rawBody)
    return verifier.verify(
      Buffer.from(publicKey, 'hex'),
      Buffer.from(signature, 'hex')
    )
  } catch {
    return false
  }
}

export function makeEmbed(
  title: string,
  description: string,
  color: number,
  fields?: Array<{ name: string; value: string; inline?: boolean }>
): DiscordEmbed {
  return { title, description, color, fields, timestamp: new Date().toISOString() }
}

export async function sendDiscordWebhook(
  url: string,
  content: string,
  embeds?: DiscordEmbed[]
): Promise<void> {
  const body: Record<string, unknown> = {}
  if (content) body.content = content
  if (embeds?.length) body.embeds = embeds

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Discord webhook error: ${res.status} ${text}`)
  }
}

export async function followUpInteraction(
  applicationId: string,
  interactionToken: string,
  content: string,
  embeds?: DiscordEmbed[]
): Promise<void> {
  const body: Record<string, unknown> = {}
  if (content) body.content = content
  if (embeds?.length) body.embeds = embeds

  const res = await fetch(
    `https://discord.com/api/v10/webhooks/${applicationId}/${interactionToken}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  )
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Discord follow-up error: ${res.status} ${text}`)
  }
}
