const supabase = require('../supabase');
const currencyService = require('./currencyService');

class PriceService {
    constructor() {
        this.adminClient = () => supabase.getAdminClient();
    }

    generateRandomPrice(minPrice, maxPrice) {
        const range = maxPrice - minPrice;
        const randomFactor = Math.random();
        return parseFloat((minPrice + range * randomFactor).toFixed(4));
    }

    calculateChangePercentage(previousPrice, newPrice) {
        const prev = Number(previousPrice);
        const next = Number(newPrice);

        if (!Number.isFinite(prev) || prev <= 0 || !Number.isFinite(next)) {
            return 0;
        }

        const change = ((next - prev) / prev) * 100;
        return parseFloat(change.toFixed(2));
    }

    async getCurrentPriceRecord(commodityId) {
        try {
            const client = this.adminClient();
            const { data, error } = await client
                .from('current_prices')
                .select('price_zar, last_updated')
                .eq('commodity_id', commodityId)
                .maybeSingle();

            if (error) {
                throw error;
            }

            return data ?? null;
        } catch (error) {
            console.error(`Error fetching current price for commodity ${commodityId}:`, error);
            return null;
        }
    }

    async updateDailyPrices({ triggerSource = 'manual', triggeredBy = null } = {}) {
        try {
            const client = this.adminClient();
            console.log('Starting daily price update (Supabase)...');

            const zarToUsdRate = await currencyService.getCurrencyRate('ZAR', 'USD');
            if (!zarToUsdRate) {
                throw new Error('Failed to load exchange rate');
            }

            const usdToZarRate = Number((1 / zarToUsdRate).toFixed(6));
            const parseNumber = (value) => {
                if (value === null || value === undefined) {
                    return undefined;
                }
                const numeric = Number(value);
                return Number.isFinite(numeric) ? numeric : undefined;
            };

            const { data: ranges, error: rangeError } = await client
                .from('price_ranges')
                .select(`
                    commodity_id,
                    min_price_zar,
                    max_price_zar,
                    min_price_usd,
                    max_price_usd,
                    is_active,
                    commodities!inner(id, name, symbol, is_active)
                `)
                .eq('is_active', true);

            if (rangeError) {
                throw rangeError;
            }

            const activeRanges = (ranges || []).filter((range) => range.commodities?.is_active);

            let updatedCount = 0;
            const skipped = [];
            const failures = [];

            await Promise.all(activeRanges.map(async (range) => {
                try {
                    const commodityId = range.commodity_id;
                    const minUsdRaw = parseNumber(range.min_price_usd);
                    const maxUsdRaw = parseNumber(range.max_price_usd);
                    const minZarRaw = parseNumber(range.min_price_zar);
                    const maxZarRaw = parseNumber(range.max_price_zar);

                    let minUsd;
                    let maxUsd;

                    if (minUsdRaw !== undefined && maxUsdRaw !== undefined) {
                        minUsd = minUsdRaw;
                        maxUsd = maxUsdRaw;
                    } else if (minZarRaw !== undefined && maxZarRaw !== undefined) {
                        minUsd = minZarRaw * zarToUsdRate;
                        maxUsd = maxZarRaw * zarToUsdRate;
                    } else {
                        skipped.push({
                            commodityId,
                            reason: 'Incomplete price range values',
                            minUsd: minUsdRaw,
                            maxUsd: maxUsdRaw,
                            minZar: minZarRaw,
                            maxZar: maxZarRaw
                        });
                        console.warn(`Skipping commodity ${commodityId} due to incomplete price range`);
                        return;
                    }

                    const newPriceUsd = this.generateRandomPrice(minUsd, maxUsd);
                    const newPriceZar = parseFloat((newPriceUsd * usdToZarRate).toFixed(4));
                    const normalizedPriceUsd = parseFloat(newPriceUsd.toFixed(4));
                    const currentRecord = await this.getCurrentPriceRecord(commodityId);
                    const previousPriceZar = currentRecord?.price_zar ? Number(currentRecord.price_zar) : null;
                    const change24hValue = this.calculateChangePercentage(previousPriceZar, newPriceZar);

                    const { error: currentError } = await client
                        .from('current_prices')
                        .upsert({
                            commodity_id: commodityId,
                            price_zar: newPriceZar,
                            price_usd: normalizedPriceUsd,
                            exchange_rate: zarToUsdRate,
                            change_24h_percent: change24hValue,
                            last_updated: new Date().toISOString()
                        }, { onConflict: 'commodity_id' });

                    if (currentError) {
                        throw currentError;
                    }

                    const { error: historyError } = await client
                        .from('price_history')
                        .insert({
                            commodity_id: commodityId,
                            price_zar: newPriceZar,
                            price_usd: normalizedPriceUsd,
                            exchange_rate: zarToUsdRate,
                            recorded_date: new Date().toISOString().split('T')[0]
                        });

                    if (historyError) {
                        throw historyError;
                    }

                    console.log(`Updated ${range.commodities.symbol}: R${newPriceZar}`);
                    updatedCount += 1;
                } catch (error) {
                    const friendlyError = {
                        commodityId: range.commodity_id,
                        symbol: range.commodities?.symbol ?? null,
                        message: error?.message ?? String(error),
                        code: error?.code ?? null,
                        details: error?.details ?? null,
                        hint: error?.hint ?? null
                    };

                    console.error(`Error updating commodity ${range.commodity_id}:`, friendlyError, error);
                    failures.push(friendlyError);
                }
            }));

            const { error: rateError } = await client
                .from('exchange_rates')
                .insert({
                    from_currency: 'ZAR',
                    to_currency: 'USD',
                    rate: zarToUsdRate,
                    source: 'daily_update'
                });

            if (rateError) {
                console.error('Failed to log exchange rate:', rateError);
            }

            try {
                await client
                    .from('price_update_runs')
                    .insert({
                        executed_at: new Date().toISOString(),
                        triggered_by: triggeredBy,
                        trigger_source: triggerSource,
                        total_commodities: activeRanges.length,
                        updated_commodities: updatedCount,
                        status: updatedCount > 0 ? 'success' : 'no_updates'
                    });
            } catch (runError) {
                console.error('Failed to log price update run:', runError);
            }

            console.log(`Daily price update complete (${updatedCount}/${activeRanges.length} commodities).`);
            if (skipped.length > 0) {
                console.warn('Skipped commodities:', skipped);
            }
            if (failures.length > 0) {
                console.error('Failed commodities:', failures);
            }

            return {
                success: true,
                updated: updatedCount,
                total: activeRanges.length,
                skipped,
                failures
            };
        } catch (error) {
            console.error('Daily price update failed:', error);
            throw error;
        }
    }

    async updateCommodityPrice(commodityId, prices = {}, triggeredBy = null, triggerSource = 'manual_single') {
        try {
            const client = this.adminClient();
            const zarToUsdRate = await currencyService.getCurrencyRate('ZAR', 'USD');
            if (!zarToUsdRate) {
                throw new Error('Failed to load exchange rate');
            }

            const usdToZarRate = Number((1 / zarToUsdRate).toFixed(6));
            const parseNumber = (value) => {
                if (value === null || value === undefined) {
                    return undefined;
                }
                const numeric = Number(value);
                return Number.isFinite(numeric) ? numeric : undefined;
            };

            let priceUsd = parseNumber(prices.priceUsd);
            let priceZar = parseNumber(prices.priceZar);

            if (priceUsd === undefined && priceZar === undefined) {
                throw new Error('A price must be provided in USD or ZAR');
            }

            if (priceUsd === undefined && priceZar !== undefined) {
                priceUsd = parseFloat((priceZar * zarToUsdRate).toFixed(4));
            }

            if (priceZar === undefined && priceUsd !== undefined) {
                priceZar = parseFloat((priceUsd * usdToZarRate).toFixed(4));
            }

            if (priceUsd === undefined || priceZar === undefined) {
                throw new Error('Unable to resolve USD and ZAR price values');
            }

            const normalizedUsd = parseFloat(priceUsd.toFixed(4));
            const normalizedZar = parseFloat(priceZar.toFixed(4));
            const currentRecord = await this.getCurrentPriceRecord(commodityId);
            const previousPriceZar = currentRecord?.price_zar ? Number(currentRecord.price_zar) : null;
            const change24hValue = this.calculateChangePercentage(previousPriceZar, normalizedZar);

            const { error: currentError } = await client
                .from('current_prices')
                .upsert({
                    commodity_id: commodityId,
                    price_zar: normalizedZar,
                    price_usd: normalizedUsd,
                    exchange_rate: zarToUsdRate,
                    change_24h_percent: change24hValue,
                    last_updated: new Date().toISOString()
                }, { onConflict: 'commodity_id' });

            if (currentError) {
                throw currentError;
            }

            const { error: historyError } = await client
                .from('price_history')
                .insert({
                    commodity_id: commodityId,
                    price_zar: normalizedZar,
                    price_usd: normalizedUsd,
                    exchange_rate: zarToUsdRate,
                    recorded_date: new Date().toISOString().split('T')[0]
                });

            if (historyError) {
                throw historyError;
            }

            try {
                await client
                    .from('price_update_runs')
                    .insert({
                        executed_at: new Date().toISOString(),
                        triggered_by: triggeredBy,
                        trigger_source: triggerSource,
                        total_commodities: 1,
                        updated_commodities: 1,
                        status: 'success',
                        notes: `Manual price update for commodity ${commodityId}`
                    });
            } catch (runError) {
                console.error('Failed to log manual price update:', runError);
            }

            return {
                success: true,
                data: {
                    commodity_id: commodityId,
                    price_zar: normalizedZar,
                    price_usd: normalizedUsd,
                    change_24h_percent: change24h,
                    exchange_rate: zarToUsdRate
                }
            };
        } catch (error) {
            console.error('Manual price update failed:', error);
            throw error;
        }
    }

    async getPriceRange(commodityId) {
        try {
            const client = this.adminClient();
            const { data, error } = await client
                .from('price_ranges')
                .select('commodity_id, min_price_zar, max_price_zar, min_price_usd, max_price_usd, is_active')
                .eq('commodity_id', commodityId)
                .maybeSingle();

            if (error) {
                throw error;
            }

            return data;
        } catch (error) {
            console.error('Error fetching price range:', error);
            return null;
        }
    }

    async updatePriceRange(commodityId, range = {}, updatedBy = null) {
        try {
            const client = this.adminClient();
            const zarToUsdRate = await currencyService.getCurrencyRate('ZAR', 'USD');
            if (!zarToUsdRate) {
                throw new Error('Failed to load exchange rate for price range update');
            }

            const usdToZarRate = Number((1 / zarToUsdRate).toFixed(6));
            const parseNumber = (value) => {
                if (value === null || value === undefined) {
                    return undefined;
                }
                const numeric = Number(value);
                return Number.isFinite(numeric) ? numeric : undefined;
            };

            let minPriceUsd = parseNumber(range.minPriceUsd);
            let maxPriceUsd = parseNumber(range.maxPriceUsd);
            let minPriceZar = parseNumber(range.minPriceZar);
            let maxPriceZar = parseNumber(range.maxPriceZar);

            if (minPriceUsd !== undefined && maxPriceUsd !== undefined) {
                minPriceZar = parseFloat((minPriceUsd * usdToZarRate).toFixed(4));
                maxPriceZar = parseFloat((maxPriceUsd * usdToZarRate).toFixed(4));
            } else if (minPriceZar !== undefined && maxPriceZar !== undefined) {
                minPriceUsd = parseFloat((minPriceZar * zarToUsdRate).toFixed(4));
                maxPriceUsd = parseFloat((maxPriceZar * zarToUsdRate).toFixed(4));
            } else {
                throw new Error('Valid price range values were not provided');
            }

            if (minPriceUsd >= maxPriceUsd || minPriceZar >= maxPriceZar) {
                throw new Error('Minimum price must be less than maximum price');
            }

            const { data, error } = await client
                .from('price_ranges')
                .upsert({
                    commodity_id: commodityId,
                    min_price_zar: minPriceZar,
                    max_price_zar: maxPriceZar,
                    min_price_usd: minPriceUsd,
                    max_price_usd: maxPriceUsd,
                    is_active: true,
                    updated_by: updatedBy,
                    updated_at: new Date().toISOString()
                }, { onConflict: 'commodity_id' })
                .select('commodity_id, min_price_zar, max_price_zar, min_price_usd, max_price_usd, is_active')
                .single();

            if (error) {
                throw error;
            }

            return {
                success: true,
                data
            };
        } catch (error) {
            console.error('Price range update failed:', error);
            throw error;
        }
    }

    async getCommodityStats(commodityId, period = '30d') {
        try {
            const periodDaysMap = {
                '7d': 7,
                '30d': 30,
                '90d': 90,
                '1y': 365
            };

            const days = periodDaysMap[period] ?? 30;
            const sinceDate = new Date();
            sinceDate.setDate(sinceDate.getDate() - days);
            const since = sinceDate.toISOString().split('T')[0];

            const client = this.adminClient();
            const { data, error } = await client
                .from('price_history')
                .select('price_zar, price_usd, recorded_date')
                .eq('commodity_id', commodityId)
                .gte('recorded_date', since)
                .order('recorded_date', { ascending: true });

            if (error) {
                throw error;
            }

            if (!data || data.length === 0) {
                return null;
            }

            const pricesZar = data.map((item) => Number(item.price_zar));
            const pricesUsd = data.map((item) => Number(item.price_usd));

            const sum = (arr) => arr.reduce((total, value) => total + value, 0);

            return {
                data_points: data.length,
                min_price_zar: Math.min(...pricesZar),
                max_price_zar: Math.max(...pricesZar),
                avg_price_zar: parseFloat((sum(pricesZar) / pricesZar.length).toFixed(4)),
                min_price_usd: Math.min(...pricesUsd),
                max_price_usd: Math.max(...pricesUsd),
                avg_price_usd: parseFloat((sum(pricesUsd) / pricesUsd.length).toFixed(4)),
                period_start: data[0].recorded_date,
                period_end: data[data.length - 1].recorded_date
            };
        } catch (error) {
            console.error('Error calculating commodity stats:', error);
            throw error;
        }
    }

    async getLatestExchangeRate(fromCurrency = 'ZAR', toCurrency = 'USD') {
        try {
            const client = this.adminClient();
            const { data, error } = await client
                .from('exchange_rates')
                .select('rate, recorded_at, source')
                .eq('from_currency', fromCurrency)
                .eq('to_currency', toCurrency)
                .order('recorded_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (error) {
                throw error;
            }

            return data;
        } catch (error) {
            console.error('Error fetching latest exchange rate:', error);
            throw error;
        }
    }

    async getDashboardSummary() {
        try {
            const client = this.adminClient();

            const [commoditiesResult, categoriesResult, latestPriceResult, latestRunResult, latestExchangeRate] = await Promise.all([
                client
                    .from('commodities')
                    .select('id, is_active'),
                client
                    .from('commodity_categories')
                    .select('id'),
                client
                    .from('current_prices')
                    .select('last_updated, source')
                    .order('last_updated', { ascending: false })
                    .limit(1)
                    .maybeSingle(),
                client
                    .from('price_update_runs')
                    .select('executed_at, trigger_source, updated_commodities, total_commodities, status')
                    .order('executed_at', { ascending: false })
                    .limit(1)
                    .maybeSingle(),
                this.getLatestExchangeRate('ZAR', 'USD').catch(() => null)
            ]);

            const { data: commoditiesData = [], error: commoditiesError } = commoditiesResult;
            if (commoditiesError) {
                throw commoditiesError;
            }

            const { data: categoriesData = [], error: categoriesError } = categoriesResult;
            if (categoriesError) {
                throw categoriesError;
            }

            const {
                data: latestPriceData = null,
                error: latestPriceError
            } = latestPriceResult ?? {};

            if (latestPriceError && latestPriceError.code !== 'PGRST116') {
                throw latestPriceError;
            }

            const {
                data: latestRunData = null,
                error: latestRunError
            } = latestRunResult ?? {};

            if (latestRunError && latestRunError.code !== 'PGRST116') {
                throw latestRunError;
            }

            const totalCommodities = commoditiesData.length;
            const activeCommodities = commoditiesData.filter((item) => item.is_active).length;

            return {
                total_commodities: totalCommodities,
                active_commodities: activeCommodities,
                total_categories: categoriesData.length,
                last_price_update: latestPriceData?.last_updated ?? null,
                last_price_update_source: latestPriceData?.source ?? null,
                last_price_run: latestRunData
                    ? {
                        executed_at: latestRunData.executed_at,
                        trigger_source: latestRunData.trigger_source,
                        status: latestRunData.status,
                        updated_commodities: latestRunData.updated_commodities,
                        total_commodities: latestRunData.total_commodities
                    }
                    : null,
                latest_exchange_rate: latestExchangeRate
            };
        } catch (error) {
            console.error('Error generating dashboard summary:', error);
            throw error;
        }
    }
}

module.exports = new PriceService();
