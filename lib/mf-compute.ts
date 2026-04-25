import type { MFTransaction } from './portfolio-types'

type TxnSlice = Pick<MFTransaction, 'trade_type' | 'units' | 'nav'>

export function computeMFLots(txns: TxnSlice[]): { units: number; invested: number } {
  const lots: { units: number; nav: number }[] = []
  for (const t of txns) {
    if (t.trade_type === 'buy') {
      lots.push({ units: t.units, nav: t.nav })
    } else {
      let toSell = t.units
      while (toSell > 0.0001 && lots.length > 0) {
        const lot = lots[0]
        if (lot.units <= toSell) { toSell -= lot.units; lots.shift() }
        else                     { lot.units -= toSell; toSell = 0  }
      }
    }
  }
  return {
    units:    lots.reduce((s, l) => s + l.units, 0),
    invested: lots.reduce((s, l) => s + l.units * l.nav, 0),
  }
}
