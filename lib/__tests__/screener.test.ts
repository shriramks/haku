import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchScreenerData } from '../screener'

// CAMS validation targets from investigation:
// EPS = 19.20, PAT Now = 472, PAT 3yr Ago = 285, ROCE 3yr Avg ≈ 50.4%, Mcap ≈ 19600

const CAMS_HTML = `
<html>
<body>
  <div id="top-ratios">
    <ul>
      <li><span class="name">Market Cap</span><span class="number">19,600</span></li>
      <li><span class="name">Current Price</span><span class="number">1,023</span></li>
    </ul>
  </div>

  <section id="profit-loss">
    <table>
      <thead>
        <tr>
          <th>Standalone Figures in Rs. Crores</th>
          <th>Mar 2016</th>
          <th>Mar 2017</th>
          <th>Mar 2018</th>
          <th>Mar 2019</th>
          <th>Mar 2020</th>
          <th>Mar 2021</th>
          <th>Mar 2022</th>
          <th>Mar 2023</th>
          <th>Mar 2024</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Net Profit</td>
          <td>146</td>
          <td>131</td>
          <td>172</td>
          <td>205</td>
          <td>287</td>
          <td>285</td>
          <td>351</td>
          <td>465</td>
          <td>472</td>
        </tr>
        <tr>
          <td>EPS in Rs</td>
          <td>5.99</td>
          <td>6.12</td>
          <td>7.05</td>
          <td>8.42</td>
          <td>11.77</td>
          <td>11.70</td>
          <td>14.40</td>
          <td>19.08</td>
          <td>19.20</td>
        </tr>
      </tbody>
    </table>
  </section>

  <section id="ratios">
    <table>
      <tbody>
        <tr>
          <td>ROCE %</td>
          <td>42.1</td>
          <td>38.5</td>
          <td>44.2</td>
          <td>47.0</td>
          <td>53.3</td>
          <td>48.9</td>
          <td>49.0</td>
          <td>53.2</td>
        </tr>
      </tbody>
    </table>
  </section>
</body>
</html>
`

// ROCE last 3: 49.0, 53.2, ... wait — let me use values that average to ~50.4
// 49.0 + 53.2 + 49.0 = 151.2 / 3 = 50.4
// Using: 49.0, 53.2, 49.0 → but last 3 values in fixture are 49.0, 53.2 — need a third
// Fixture has 8 values: last 3 are 49.0, 53.2 → we need one more
// Let's use: ..., 48.9, 49.0, 53.2 → avg = (48.9 + 49.0 + 53.2) / 3 = 151.1 / 3 = 50.367 ≈ 50.4 ✓
// The fixture above already has these last 3 values.

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('fetchScreenerData', () => {
  it('parses EPS, PAT, ROCE, Mcap, and asOf from CAMS-like HTML', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => CAMS_HTML,
    }))

    const result = await fetchScreenerData('CAMS')

    expect(result.eps).toBe(19.20)
    expect(result.patNow).toBe(472)
    // PAT 3yr ago: 4th from right in [146,131,172,205,287,285,351,465,472] = index 5 = 285
    expect(result.pat3yrAgo).toBe(285)
    // ROCE last 3 from [42.1,38.5,44.2,47.0,53.3,48.9,49.0,53.2]: last 3 = 48.9, 49.0, 53.2
    expect(result.roce3yrAvg).toBeCloseTo(50.367, 1)
    expect(result.mcap).toBe(19600)
    expect(result.asOf).toBe('Mar 2024')
  })

  it('calls the correct URL with a browser User-Agent', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => CAMS_HTML,
    })
    vi.stubGlobal('fetch', mockFetch)

    await fetchScreenerData('CAMS')

    expect(mockFetch).toHaveBeenCalledWith(
      'https://www.screener.in/company/CAMS/consolidated/',
      expect.objectContaining({
        headers: expect.objectContaining({
          'User-Agent': expect.stringContaining('Mozilla'),
        }),
      }),
    )
  })

  it('throws when fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }))
    await expect(fetchScreenerData('CAMS')).rejects.toThrow('Screener fetch failed: 403')
  })

  it('throws when #profit-loss section is missing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '<html><body></body></html>',
    }))
    await expect(fetchScreenerData('CAMS')).rejects.toThrow('#profit-loss section not found')
  })
})
