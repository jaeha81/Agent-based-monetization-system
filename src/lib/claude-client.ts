import Anthropic from '@anthropic-ai/sdk'

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
})

export const USE_MOCK = process.env.USE_MOCK_DATA === 'true'

export function mockDelay(ms = 1200) {
  return new Promise(r => setTimeout(r, ms))
}

export interface AgentMessage {
  role: 'user' | 'assistant'
  content: string | Anthropic.MessageParam['content']
}

export async function runToolLoop(
  systemPrompt: string,
  userMessage: string,
  tools: Anthropic.Tool[],
  toolHandler: (name: string, input: Record<string, unknown>) => Promise<unknown>
): Promise<{ text: string; toolCalls: string[] }> {
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: userMessage }
  ]

  const toolCalls: string[] = []
  let finalText = ''

  for (let i = 0; i < 8; i++) {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      tools,
      messages,
    })

    if (response.stop_reason === 'end_turn') {
      finalText = response.content
        .filter(b => b.type === 'text')
        .map(b => (b as Anthropic.TextBlock).text)
        .join('\n')
      break
    }

    if (response.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: response.content })

      const toolResults: Anthropic.ToolResultBlockParam[] = []
      for (const block of response.content) {
        if (block.type === 'tool_use') {
          toolCalls.push(`${block.name}(${JSON.stringify(block.input)})`)
          const result = await toolHandler(block.name, block.input as Record<string, unknown>)
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result),
          })
        }
      }
      messages.push({ role: 'user', content: toolResults })
    }
  }

  return { text: finalText, toolCalls }
}
