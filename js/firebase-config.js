const firebaseConfig = {
    apiKey: "AIzaSyAWEF_WEDqMTQAP61zmqTyMN-AK43OWoT4",
    authDomain: "guesthousesystem-86fdc.firebaseapp.com",
    projectId: "guesthousesystem-86fdc",
    storageBucket: "guesthousesystem-86fdc.firebasestorage.app",
    messagingSenderId: "482448753298",
    appId: "1:482448753298:web:e3e17de5bbf0f268121c4b",
    measurementId: "G-1YGYCD1M28"
};

firebase.initializeApp(firebaseConfig);

const db = firebase.firestore();