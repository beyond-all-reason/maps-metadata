// This files is basically following example on:
// https://firebase.google.com/docs/auth/admin/custom-claims#defining_roles_via_firebase_functions_on_user_creation

import { onUserCreated } from "firebase-functions/v2/identity";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

initializeApp();

export const processSignUp = onUserCreated({ region: "europe-west1" }, async (event) => {
    const user = event.data;
    try {
        await getAuth().setCustomUserClaims(user.uid, { roles: ["VIEWER"] });
        await getFirestore().collection("_rowy_/userManagement/users").doc(user.uid).set({
            roles: ["VIEWER"],
            user: {
                email: user.email,
                displayName: user.displayName,
                photoURL: user.photoURL,
            },
            refreshTime: new Date().getTime()
        });
    } catch (error) {
        console.error(error);
    }
});
