const cache = {};

const CACHE_DURATION = 60 * 1000;

module.exports = {

    get(agentId) {

        const item = cache[agentId];

        if (!item)
            return null;

        if (Date.now() > item.expiry) {

            delete cache[agentId];

            return null;

        }

        return item.data;

    },

    set(agentId, dashboard) {

        cache[agentId] = {

            data: dashboard,

            expiry: Date.now() + CACHE_DURATION

        };

    },

    clear(agentId) {

        delete cache[agentId];

    },

    has(agentId) {

        return this.get(agentId) !== null;

    },

    touch(agentId) {

        const item = cache[agentId];

        if (!item)
            return;

        item.expiry = Date.now() + CACHE_DURATION;

    },

    clearAll() {

        Object.keys(cache).forEach(key => {

            delete cache[key];

        });

    }

};