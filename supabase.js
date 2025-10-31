const { createClient } = require('@supabase/supabase-js');

class SupabaseClient {
    constructor() {
        this.supabaseUrl = process.env.SUPABASE_URL;
        this.supabaseKey = process.env.SUPABASE_ANON_KEY;
        this.serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!this.supabaseUrl || !this.supabaseKey) {
            throw new Error('Missing Supabase configuration. Please set SUPABASE_URL and SUPABASE_ANON_KEY in your .env file');
        }

        if (!this.serviceRoleKey) {
            const warning = '[Supabase] SUPABASE_SERVICE_ROLE_KEY is not set. Admin operations may fail due to RLS restrictions.';
            if ((process.env.NODE_ENV || 'development') === 'production') {
                throw new Error(`${warning} Set SUPABASE_SERVICE_ROLE_KEY in the backend environment.`);
            }
            console.warn(warning);
        }

        // Client for general operations
        this.client = createClient(this.supabaseUrl, this.supabaseKey);
        
        // Service role client for admin operations (bypasses RLS)
        this.adminClient = this.serviceRoleKey 
            ? createClient(this.supabaseUrl, this.serviceRoleKey)
            : this.client;
    }

    // Get client instance
    getClient() {
        return this.client;
    }

    // Get admin client instance (for server-side operations)
    getAdminClient() {
        return this.adminClient;
    }

    // Query helper method
    async query(table, options = {}) {
        try {
            let query = this.client.from(table);

            // Apply select
            if (options.select) {
                query = query.select(options.select);
            } else {
                query = query.select('*');
            }

            // Apply filters
            if (options.filters) {
                options.filters.forEach(filter => {
                    const { column, operator, value } = filter;
                    query = query[operator](column, value);
                });
            }

            // Apply ordering
            if (options.orderBy) {
                const { column, ascending = true } = options.orderBy;
                query = query.order(column, { ascending });
            }

            // Apply limit
            if (options.limit) {
                query = query.limit(options.limit);
            }

            // Apply range
            if (options.range) {
                const { from, to } = options.range;
                query = query.range(from, to);
            }

            const { data, error } = await query;

            if (error) {
                throw error;
            }

            return data;
        } catch (error) {
            console.error('Supabase query error:', error);
            throw error;
        }
    }

    // Insert helper method
    async insert(table, data, options = {}) {
        try {
            const client = options.useAdmin ? this.adminClient : this.client;
            let query = client.from(table).insert(data);

            if (options.select) {
                query = query.select(options.select);
            }

            const { data: result, error } = await query;

            if (error) {
                throw error;
            }

            return result;
        } catch (error) {
            console.error('Supabase insert error:', error);
            throw error;
        }
    }

    // Update helper method
    async update(table, data, filters, options = {}) {
        try {
            const client = options.useAdmin ? this.adminClient : this.client;
            let query = client.from(table).update(data);

            // Apply filters
            filters.forEach(filter => {
                const { column, operator, value } = filter;
                query = query[operator](column, value);
            });

            if (options.select) {
                query = query.select(options.select);
            }

            const { data: result, error } = await query;

            if (error) {
                throw error;
            }

            return result;
        } catch (error) {
            console.error('Supabase update error:', error);
            throw error;
        }
    }

    // Delete helper method
    async delete(table, filters, options = {}) {
        try {
            const client = options.useAdmin ? this.adminClient : this.client;
            let query = client.from(table);

            // Apply filters
            filters.forEach(filter => {
                const { column, operator, value } = filter;
                query = query[operator](column, value);
            });

            const { data, error } = await query.delete();

            if (error) {
                throw error;
            }

            return data;
        } catch (error) {
            console.error('Supabase delete error:', error);
            throw error;
        }
    }

    // Get single record
    async get(table, filters, options = {}) {
        try {
            const results = await this.query(table, {
                ...options,
                filters,
                limit: 1
            });

            return results && results.length > 0 ? results[0] : null;
        } catch (error) {
            console.error('Supabase get error:', error);
            throw error;
        }
    }

    // Execute raw SQL (admin only)
    async sql(query, params = []) {
        try {
            const { data, error } = await this.adminClient.rpc('execute_sql', {
                query,
                params
            });

            if (error) {
                throw error;
            }

            return data;
        } catch (error) {
            console.error('Supabase SQL error:', error);
            throw error;
        }
    }

    // Test connection
    async testConnection() {
        try {
            const { data, error } = await this.client
                .from('commodity_categories')
                .select('count')
                .limit(1);

            if (error) {
                throw error;
            }

            console.log(' Supabase connection successful');
            return true;
        } catch (error) {
            console.error(' Supabase connection failed:', error.message);
            return false;
        }
    }
}

module.exports = new SupabaseClient();
