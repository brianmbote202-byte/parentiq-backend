const cache = {};

const CACHE_DURATION = 60 * 1000;

module.exports = {

    /*
    ==========================================
    GET
    ==========================================
    */

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

    /*
    ==========================================
    SET
    ==========================================
    */

    set(agentId, customers) {

        cache[agentId] = {

            data: customers,

            expiry: Date.now() + CACHE_DURATION

        };

    },

    /*
    ==========================================
    CLEAR
    ==========================================
    */

    clear(agentId) {

        delete cache[agentId];

    },

    /*
    ==========================================
    HAS
    ==========================================
    */

    has(agentId) {

        return this.get(agentId) !== null;

    },

    /*
    ==========================================
    REFRESH EXPIRY
    ==========================================
    */

    touch(agentId) {

        const item = cache[agentId];

        if (!item)
            return;

        item.expiry = Date.now() + CACHE_DURATION;

    },

    /*
    ==========================================
    CLEAR EVERYTHING
    ==========================================
    */

    clearAll() {

        Object.keys(cache).forEach(key => {

            delete cache[key];

        });

    }

};