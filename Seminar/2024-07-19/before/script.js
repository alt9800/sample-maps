import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getFirestore, collection, doc, setDoc, getDoc, getDocs, GeoPoint, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

// Firebaseの設定
const firebaseConfig = {
    apiKey: "{APIkey}",
    authDomain: "project-{ID}.firebaseapp.com",
    projectId: "project-{ID}",
    storageBucket: "project-{ID}.appspot.com",
    messagingSenderId: "{ID2}",
    appId: "1:{ID2}:web:{ID3}"
};

// Firebaseの初期化
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Leaflet地図の初期化
const map = L.map('map').setView([35.6895, 139.6917], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

// マーカーを格納する配列
let markers = [];

// ユーザー選択のプルダウンを生成
const userSelect = document.getElementById('user-select');
for (let i = 1; i <= 20; i++) {
    const option = document.createElement('option');
    option.value = `user${i.toString().padStart(2, '0')}`;
    option.textContent = `ユーザー${i}`;
    userSelect.appendChild(option);
}

// 地図をクリックしたときの処理
map.on('click', function(e) {
    document.getElementById('lat').value = e.latlng.lat.toFixed(6);
    document.getElementById('lng').value = e.latlng.lng.toFixed(6);
});

// 送信ボタンのクリックイベント
document.getElementById('submit-btn').addEventListener('click', async function() {
    const userId = document.getElementById('user-select').value;
    const id = document.getElementById('id').value;
    const userName = document.getElementById('userName').value;
    const comment = document.getElementById('comment').value;
    const lat = parseFloat(document.getElementById('lat').value);
    const lng = parseFloat(document.getElementById('lng').value);

    if (!userId || !id || !userName || !comment || isNaN(lat) || isNaN(lng)) {
        alert('すべてのフィールドを入力してください。');
        return;
    }

    const data = {
        location: new GeoPoint(lat, lng),
        userName: userName,
        comment: comment,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    };

    try {
        const idDocRef = doc(db, 'LatLngs', userId, id);
        await setDoc(idDocRef, data);

        alert('データが保存されました。');
        displayMarkers(userId);
    } catch (error) {
        console.error("Error adding/updating document: ", error);
        alert('データの保存/更新に失敗しました。');
    }
});

// 表示ボタンのクリックイベント
document.getElementById('display-btn').addEventListener('click', function() {
    const userId = document.getElementById('user-select').value;
    if (!userId) {
        alert('ユーザーを選択してください。');
        return;
    }
    displayMarkers(userId);
});

// マーカーを表示する関数
async function displayMarkers(userId) {
    // 既存のマーカーをクリア
    markers.forEach(marker => map.removeLayer(marker));
    markers = [];

    try {
        const userCollectionRef = collection(db, 'LatLngs', userId);
        const querySnapshot = await getDocs(userCollectionRef);

        querySnapshot.forEach((doc) => {
            const data = doc.data();
            const marker = L.marker([data.location.latitude, data.location.longitude])
                .addTo(map)
                .bindPopup(`ID: ${doc.id}<br>ユーザー名: ${data.userName}<br>コメント: ${data.comment}`);
            markers.push(marker);
        });

        if (markers.length > 0) {
            const group = new L.featureGroup(markers);
            map.fitBounds(group.getBounds());
        } else {
            alert('選択されたユーザーのデータが存在しません。');
        }
    } catch (error) {
        console.error("Error getting documents: ", error);
        alert('データの取得に失敗しました。');
    }
}