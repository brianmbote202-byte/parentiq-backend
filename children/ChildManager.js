const { db } = require("../firebase");

class ChildManager {

    /**
     * Returns the entire child object.
     */
    async getChild(childId) {

        const snapshot = await db
            .ref("children")
            .child(childId)
            .get();

        if (!snapshot.exists()) {
            return null;
        }

        return snapshot.val();
    }

    /**
     * Returns true if child exists.
     */
    async childExists(childId) {

        const child = await this.getChild(childId);

        return child !== null;
    }

    /**
     * Returns the child's name.
     */
    async getName(childId) {

        const child = await this.getChild(childId);

        return child ? child.name : null;
    }

    /**
     * Returns parent ID.
     */
    async getParentId(childId) {

        const child = await this.getChild(childId);

        return child ? child.parentId : null;
    }

    /**
     * Returns true if paired.
     */
    async isPaired(childId) {

        const child = await this.getChild(childId);

        return child ? child.paired === true : false;
    }

    /**
     * Returns true if online.
     */
    async isOnline(childId) {

        const child = await this.getChild(childId);

        return child ? child.online === true : false;
    }

    /**
     * Returns battery percentage.
     */
    async getBattery(childId) {

        const child = await this.getChild(childId);

        return child ? child.battery : null;
    }

    /**
     * Returns subscription object.
     */
    async getSubscription(childId) {

        const child = await this.getChild(childId);

        return child ? child.subscription : null;
    }

}

module.exports = new ChildManager();