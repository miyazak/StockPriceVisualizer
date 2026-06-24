import { useEffect, useMemo, useState } from 'react'
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from 'recharts'
import './App.css'

type AssetType = 'JP_STOCK' | 'US_STOCK' | 'US_ETF'

type Instrument = {
  symbol: string
  name: string
  region: string
  currency: 'JPY' | 'USD'
  assetType: AssetType
}

type Holding = {
  id: string
  instrument: Instrument
  purchasePrice: number
  quantity: number
  createdAt: string
}

type Quote = {
  symbol: string
  price: number
  changePercent: number
  updatedAt: string
}

type AlphaSearchMatch = {
  '1. symbol': string
  '2. name': string
  '4. region': string
  '8. currency': string
}

type AlphaSearchResponse = {
  bestMatches?: AlphaSearchMatch[]
}

type AlphaQuoteResponse = {
  'Global Quote'?: {
    '01. symbol': string
    '05. price': string
    '10. change percent': string
  }
}

const APP_STORAGE_KEY = 'spv-holdings-v1'
const QUOTE_STORAGE_KEY = 'spv-quotes-v1'
const FX_STORAGE_KEY = 'spv-usdjpy-v1'

const PIE_COLORS = ['#f18f01', '#4f6d7a', '#1b998b']

const ASSET_LABELS: Record<AssetType, string> = {
  JP_STOCK: '日本株',
  US_STOCK: '米国株',
  US_ETF: '米国ETF',
}

const alphaVantageKey = import.meta.env.VITE_ALPHA_VANTAGE_API_KEY || 'demo'

function inferAssetType(region: string, name: string): AssetType {
  if (region.toLowerCase().includes('japan')) {
    return 'JP_STOCK'
  }

  if (/\betf\b/i.test(name)) {
    return 'US_ETF'
  }

  return 'US_STOCK'
}

function toCurrency(raw: string): 'JPY' | 'USD' {
  return raw.toUpperCase().includes('JPY') ? 'JPY' : 'USD'
}

function App() {
  const [searchKeyword, setSearchKeyword] = useState('')
  const [searchResults, setSearchResults] = useState<Instrument[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState('')

  const [selectedInstrument, setSelectedInstrument] = useState<Instrument | null>(
    null,
  )
  const [purchasePrice, setPurchasePrice] = useState('')
  const [quantity, setQuantity] = useState('')

  const [holdings, setHoldings] = useState<Holding[]>([])
  const [quotes, setQuotes] = useState<Record<string, Quote>>({})
  const [refreshingQuotes, setRefreshingQuotes] = useState(false)
  const [usdJpy, setUsdJpy] = useState(150)

  useEffect(() => {
    const rawHoldings = localStorage.getItem(APP_STORAGE_KEY)
    const rawQuotes = localStorage.getItem(QUOTE_STORAGE_KEY)
    const rawFx = localStorage.getItem(FX_STORAGE_KEY)

    if (rawHoldings) {
      setHoldings(JSON.parse(rawHoldings) as Holding[])
    }
    if (rawQuotes) {
      setQuotes(JSON.parse(rawQuotes) as Record<string, Quote>)
    }
    if (rawFx) {
      setUsdJpy(Number(rawFx))
    }
  }, [])

  useEffect(() => {
    localStorage.setItem(APP_STORAGE_KEY, JSON.stringify(holdings))
  }, [holdings])

  useEffect(() => {
    localStorage.setItem(QUOTE_STORAGE_KEY, JSON.stringify(quotes))
  }, [quotes])

  useEffect(() => {
    localStorage.setItem(FX_STORAGE_KEY, String(usdJpy))
  }, [usdJpy])

  async function searchInstruments() {
    if (!searchKeyword.trim()) {
      setSearchError('証券コードまたは企業名を入力してください。')
      return
    }

    setSearchLoading(true)
    setSearchError('')

    try {
      const endpoint = new URL('https://www.alphavantage.co/query')
      endpoint.searchParams.set('function', 'SYMBOL_SEARCH')
      endpoint.searchParams.set('keywords', searchKeyword.trim())
      endpoint.searchParams.set('apikey', alphaVantageKey)

      const response = await fetch(endpoint)
      const payload = (await response.json()) as AlphaSearchResponse

      const mapped = (payload.bestMatches || [])
        .map((item) => {
          const region = item['4. region'] || 'Unknown'
          const name = item['2. name'] || 'Unknown'
          const symbol = item['1. symbol'] || ''
          const currency = toCurrency(item['8. currency'] || 'USD')
          const assetType = inferAssetType(region, name)

          return {
            symbol,
            name,
            region,
            currency,
            assetType,
          } satisfies Instrument
        })
        .filter(
          (item) =>
            item.symbol &&
            (item.assetType === 'JP_STOCK' ||
              item.assetType === 'US_STOCK' ||
              item.assetType === 'US_ETF'),
        )
        .slice(0, 20)

      if (mapped.length === 0) {
        setSearchError('該当銘柄が見つかりませんでした。キーワードを変えて再検索してください。')
      }

      setSearchResults(mapped)
    } catch {
      setSearchError('銘柄検索APIの呼び出しに失敗しました。時間をおいて再実行してください。')
    } finally {
      setSearchLoading(false)
    }
  }

  async function refreshUsdJpyRate() {
    try {
      const response = await fetch('https://open.er-api.com/v6/latest/USD')
      const payload = (await response.json()) as {
        rates?: Record<string, number>
      }
      const rate = payload.rates?.JPY
      if (typeof rate === 'number' && Number.isFinite(rate) && rate > 0) {
        setUsdJpy(rate)
      }
    } catch {
      // Keep previous FX rate when API is unavailable.
    }
  }

  async function refreshQuotes() {
    if (holdings.length === 0) {
      return
    }

    setRefreshingQuotes(true)

    try {
      await refreshUsdJpyRate()

      const uniqueSymbols = [...new Set(holdings.map((item) => item.instrument.symbol))]
      const nextQuotes: Record<string, Quote> = { ...quotes }

      for (const symbol of uniqueSymbols) {
        const endpoint = new URL('https://www.alphavantage.co/query')
        endpoint.searchParams.set('function', 'GLOBAL_QUOTE')
        endpoint.searchParams.set('symbol', symbol)
        endpoint.searchParams.set('apikey', alphaVantageKey)

        const response = await fetch(endpoint)
        const payload = (await response.json()) as AlphaQuoteResponse
        const quote = payload['Global Quote']

        if (!quote) {
          continue
        }

        const rawPrice = Number(quote['05. price'])
        const rawChangePercent = Number(
          (quote['10. change percent'] || '0').replace('%', ''),
        )

        if (!Number.isFinite(rawPrice) || rawPrice <= 0) {
          continue
        }

        nextQuotes[symbol] = {
          symbol,
          price: rawPrice,
          changePercent: Number.isFinite(rawChangePercent) ? rawChangePercent : 0,
          updatedAt: new Date().toISOString(),
        }
      }

      setQuotes(nextQuotes)
    } finally {
      setRefreshingQuotes(false)
    }
  }

  function addHolding() {
    if (!selectedInstrument) {
      return
    }

    const numericPurchasePrice = Number(purchasePrice)
    const numericQuantity = Number(quantity)

    if (!Number.isFinite(numericPurchasePrice) || numericPurchasePrice <= 0) {
      return
    }
    if (!Number.isFinite(numericQuantity) || numericQuantity <= 0) {
      return
    }

    const newHolding: Holding = {
      id: `${selectedInstrument.symbol}-${Date.now()}`,
      instrument: selectedInstrument,
      purchasePrice: numericPurchasePrice,
      quantity: numericQuantity,
      createdAt: new Date().toISOString(),
    }

    setHoldings((prev) => [newHolding, ...prev])
    setPurchasePrice('')
    setQuantity('')
  }

  function removeHolding(id: string) {
    setHoldings((prev) => prev.filter((item) => item.id !== id))
  }

  const holdingRows = useMemo(() => {
    return holdings.map((item) => {
      const quote = quotes[item.instrument.symbol]
      const latestPrice = quote?.price ?? item.purchasePrice
      const cost = item.purchasePrice * item.quantity
      const marketValue = latestPrice * item.quantity
      const profit = marketValue - cost

      const toJpy = (value: number) =>
        item.instrument.currency === 'USD' ? value * usdJpy : value

      return {
        ...item,
        latestPrice,
        cost,
        marketValue,
        profit,
        marketValueJpy: toJpy(marketValue),
      }
    })
  }, [holdings, quotes, usdJpy])

  const pieData = useMemo(() => {
    const grouped: Record<AssetType, number> = {
      JP_STOCK: 0,
      US_STOCK: 0,
      US_ETF: 0,
    }

    for (const row of holdingRows) {
      grouped[row.instrument.assetType] += row.marketValueJpy
    }

    return (Object.keys(grouped) as AssetType[])
      .map((key) => ({
        name: ASSET_LABELS[key],
        value: grouped[key],
      }))
      .filter((item) => item.value > 0)
  }, [holdingRows])

  const totalJpy = holdingRows.reduce((sum, item) => sum + item.marketValueJpy, 0)

  return (
    <main className="app-shell">
      <header className="hero">
        <p className="eyebrow">Stock Portfolio Prototype</p>
        <h1>持ち株管理ダッシュボード</h1>
        <p className="subtitle">
          日本株・米国株・米国ETFの登録、価格更新、構成比可視化を1画面で行います。
        </p>
      </header>

      <section className="panel search-panel">
        <h2>銘柄検索（証券コード / 企業名）</h2>
        <div className="search-row">
          <input
            value={searchKeyword}
            onChange={(event) => setSearchKeyword(event.target.value)}
            placeholder="例: 7203 / Toyota / AAPL / SPY"
          />
          <button type="button" onClick={searchInstruments} disabled={searchLoading}>
            {searchLoading ? '検索中...' : '検索'}
          </button>
        </div>

        {searchError && <p className="error-text">{searchError}</p>}

        <ul className="search-results">
          {searchResults.map((item) => {
            const isSelected = selectedInstrument?.symbol === item.symbol

            return (
              <li key={`${item.symbol}-${item.region}`}>
                <button
                  type="button"
                  onClick={() => setSelectedInstrument(item)}
                  className={isSelected ? 'instrument selected' : 'instrument'}
                >
                  <span>
                    <strong>{item.symbol}</strong> {item.name}
                  </span>
                  <span className="meta">
                    {ASSET_LABELS[item.assetType]} / {item.region} / {item.currency}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </section>

      <section className="panel form-panel">
        <h2>保有登録（手入力）</h2>
        <div className="form-grid">
          <label>
            選択銘柄
            <input
              value={
                selectedInstrument
                  ? `${selectedInstrument.symbol} - ${selectedInstrument.name}`
                  : ''
              }
              readOnly
              placeholder="上の検索結果から銘柄を選択"
            />
          </label>
          <label>
            購入価格
            <input
              type="number"
              min="0"
              step="0.0001"
              value={purchasePrice}
              onChange={(event) => setPurchasePrice(event.target.value)}
              placeholder="例: 2400"
            />
          </label>
          <label>
            保有数
            <input
              type="number"
              min="0"
              step="0.0001"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              placeholder="例: 100"
            />
          </label>
          <button type="button" onClick={addHolding}>
            登録する
          </button>
        </div>
      </section>

      <section className="panel list-panel">
        <div className="list-header">
          <h2>保有一覧</h2>
          <button type="button" onClick={refreshQuotes} disabled={refreshingQuotes}>
            {refreshingQuotes ? '更新中...' : '価格更新'}
          </button>
        </div>
        <p className="fx-note">USD/JPY: {usdJpy.toFixed(2)}</p>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>銘柄</th>
                <th>区分</th>
                <th>購入価格</th>
                <th>現在価格</th>
                <th>保有数</th>
                <th>評価額</th>
                <th>損益</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {holdingRows.map((row) => {
                const quote = quotes[row.instrument.symbol]
                const currency = row.instrument.currency

                return (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.instrument.symbol}</strong>
                      <div>{row.instrument.name}</div>
                    </td>
                    <td>{ASSET_LABELS[row.instrument.assetType]}</td>
                    <td>
                      {row.purchasePrice.toLocaleString()} {currency}
                    </td>
                    <td>
                      {row.latestPrice.toLocaleString()} {currency}
                      {quote ? (
                        <div className={quote.changePercent >= 0 ? 'up' : 'down'}>
                          {quote.changePercent.toFixed(2)}%
                        </div>
                      ) : (
                        <div className="stale">未更新</div>
                      )}
                    </td>
                    <td>{row.quantity.toLocaleString()}</td>
                    <td>{Math.round(row.marketValueJpy).toLocaleString()} 円</td>
                    <td className={row.profit >= 0 ? 'up' : 'down'}>
                      {Math.round(row.profit).toLocaleString()} {currency}
                    </td>
                    <td>
                      <button type="button" onClick={() => removeHolding(row.id)}>
                        削除
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel chart-panel">
        <h2>ポートフォリオ構成比（円換算）</h2>
        <p className="total">合計評価額: {Math.round(totalJpy).toLocaleString()} 円</p>
        <div className="chart-wrap">
          {pieData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  outerRadius={120}
                  innerRadius={52}
                  paddingAngle={4}
                >
                  {pieData.map((entry, index) => (
                    <Cell key={entry.name} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value) => `${Math.round(Number(value ?? 0)).toLocaleString()} 円`}
                />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="empty-chart">保有銘柄を登録すると円グラフが表示されます。</div>
          )}
        </div>
      </section>
    </main>
  )
}

export default App
