const { admin, db } = require("../firebase");

class AdminManager {

    /**
     * Returns true if at least one admin exists.
     */
    async isInitialized() {

        const snapshot = await db.ref("admins").limitToFirst(1).get();

        return snapshot.exists();

    }

    /**
     * Returns an admin.
     */
    async getAdmin(uid) {

        const snapshot = await db
            .ref("admins")
            .child(uid)
            .get();

        if (!snapshot.exists()) {
            throw new Error("Administrator not found.");
        }

        return snapshot.val();

    }

    /**
 * Creates the first Super Administrator.
 * This method only works if no admin already exists.
 */
async bootstrap(fullName, email, password) {

    const initialized = await this.isInitialized();

    if (initialized) {
        throw new Error("System already initialized.");
    }

    const user = await admin.auth().createUser({

        email,
        password,
        displayName: fullName

    });

    const uid = user.uid;

    await db.ref("admins")
        .child(uid)
        .set({

            uid,

            fullName,

            email,

            phone: "",

            profileImage: "",

            role: "SUPER_ADMIN",

            status: "ACTIVE",

            createdAt: Date.now(),

            lastLogin: 0

        });

    return {

        uid,
        fullName,
        email

    };

}

}

module.exports = new AdminManager();