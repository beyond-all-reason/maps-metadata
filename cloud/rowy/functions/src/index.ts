// This files is basically following example on:
// https://firebase.google.com/docs/auth/admin/custom-claims#defining_roles_via_firebase_functions_on_user_creation

import * as functions from "firebase-functions";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getDatabase } from "firebase-admin/database";

initializeApp();

export const processSignUp = functions
    .region("europe-west1")
    .auth.user()
    .onCreate(async (user) => {
        try {
            await getAuth().setCustomUserClaims(user.uid, { roles: ["VIEWER"] });
            await getDatabase().ref(`_rowy_/userManagement/users/${user.uid}`).set({
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
