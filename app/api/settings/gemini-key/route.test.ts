import { beforeEach, describe, expect, it, vi } from 'vitest'

const createSupabaseServerClient = vi.fn()

vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient,
}))

type QueryResult<T> = Promise<{ data: T; error: null }>

function resolved<T>(data: T): QueryResult<T> {
  return Promise.resolve({ data, error: null })
}

function makeEqChain<T>(result: QueryResult<T>) {
  return {
    eq: vi.fn(() => ({
      maybeSingle: vi.fn(() => result),
    })),
  }
}

describe('POST /api/settings/gemini-key — risk_free flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('marks only non-index bands stale when risk_free changes', async () => {
    const updateEq = vi.fn().mockReturnValue({
      in: vi.fn().mockResolvedValue({ error: null }),
    })

    const supabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
        }),
      },
      from: vi.fn((table: string) => {
        if (table === 'user_settings') {
          return {
            select: vi.fn(() => makeEqChain(resolved({ risk_free: 0.07 }))),
            upsert: vi.fn().mockResolvedValue({ error: null }),
          }
        }

        if (table === 'stock_allocations') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue({
                data: [
                  { symbol: 'CAMS', category: 'Cap-Light Infra' },
                  { symbol: 'NIFTYBEES', category: 'Nifty 50 Index' },
                  { symbol: 'ITC', category: 'Tobacco Corp' },
                  { symbol: 'JUNIORBEES', category: 'Nifty Next 50 Index' },
                  { symbol: 'CAMS', category: 'Cap-Light Infra' },
                ],
                error: null,
              }),
            })),
          }
        }

        if (table === 'buy_bands') {
          return {
            update: vi.fn(() => ({
              eq: updateEq,
            })),
          }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    createSupabaseServerClient.mockResolvedValue(supabase)

    const { POST } = await import('./route')
    const req = {
      json: async () => ({ riskFree: 0.08 }),
    } as Request

    const res = await POST(req as never)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ success: true, riskFree: 0.08 })
    expect(supabase.from).toHaveBeenCalledWith('stock_allocations')
    expect(supabase.from).toHaveBeenCalledWith('buy_bands')
    expect(updateEq).toHaveBeenCalledWith('user_id', 'user-1')
    expect(updateEq.mock.results[0]?.value.in).toHaveBeenCalledWith('symbol', ['CAMS', 'ITC'])
  })
})
