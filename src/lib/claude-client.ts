import { GoogleGenerativeAI } from '@google/generative-ai'

export const USE_MOCK = process.env.USE_MOCK_DATA === 'true'

export function mockDelay(ms = 1200) {
  return new Promise(r => setTimeout(r, ms))
}

const genAI = new GoogleGenerativeAI((process.env.GEMINI_API_KEY || '').trim())

const REQUEST_OPTIONS = { apiVersion: 'v1' as const }

export async function generateJSON<T>(
  systemPrompt: string,
  userPrompt: string,
): Promise<T> {
  const model = genAI.getGenerativeModel(
    {
              model: 'gemini-2.5-flash',
      systemInstruction: systemPrompt,
      generationConfig: { responseMimeType: 'application/json' },
    },
    REQUEST_OPTIONS
  )
  const result = await model.generateContent(userPrompt)
  return JSON.parse(result.response.text()) as T
}

// Legacy interface — kept for any callers that type-check against it
export interface AgentMessage {
  role: 'user' | 'assistant'
  content: string
}
