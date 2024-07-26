import { firebaseConfig } from './config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getFirestore, collection, doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc, GeoPoint, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-storage.js";

// Firebase の初期化
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);

// Leaflet マップの初期化
const map = L.map('map').setView([33.98353710, 131.2984133], 15); // 宇部市新都市周辺を初期ビューにする
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
}).addTo(map);

// 現在地を表示
showCurrentLocation();
let selectedLocation = null;

// マップクリックイベント
map.on('click', function(e) {
    if (selectedLocation) {
        map.removeLayer(selectedLocation);
    }
    selectedLocation = L.marker(e.latlng, {icon: L.icon({iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png'})}).addTo(map);
    document.getElementById('new-post-modal').style.display = 'block';
});

// モーダルを閉じる
document.getElementById('close-modal').onclick = function() {
    document.getElementById('new-post-modal').style.display = 'none';
};

// 投稿を送信
document.getElementById('submit-post').onclick = async function() {
  const userName = document.getElementById('user-name').value;
  const comment = document.getElementById('comment').value;
  const imageFile = document.getElementById('image-upload').files[0];

  if (!selectedLocation || !userName || !comment || !imageFile) {
      alert('すべての項目を入力してください。');
      return;
  }

  try {
      // 画像をCloud Storageにアップロード
      const imageRef = ref(storage, 'images/' + Date.now() + '_' + imageFile.name);
      await uploadBytes(imageRef, imageFile);
      const imageUrl = await getDownloadURL(imageRef);

      // Firestoreにデータを保存
      const docRef = doc(collection(db, 'LatLngs', 'Map99', 'Markers'));
      await setDoc(docRef, {
          location: new GeoPoint(selectedLocation.getLatLng().lat, selectedLocation.getLatLng().lng),
          userName: userName,
          comment: comment,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          imageID: imageUrl  // 直接ダウンロードURLを保存
      });

      alert('投稿が完了しました。');
      document.getElementById('new-post-modal').style.display = 'none';
      loadMarkers();
  } catch (error) {
      console.error("Error adding document: ", error);
      alert('投稿に失敗しました。');
  }
};

// マーカーとデータテーブルを読み込む
async function loadMarkers() {
  const markersRef = collection(db, 'LatLngs', 'Map99', 'Markers');
  const querySnapshot = await getDocs(markersRef);
  const dataBody = document.getElementById('data-body');
  dataBody.innerHTML = '';
  map.eachLayer((layer) => {
      if (layer instanceof L.Marker) {
          map.removeLayer(layer);
      }
  });

  querySnapshot.forEach((doc) => {
      const data = doc.data();
      const marker = L.marker([data.location.latitude, data.location.longitude]).addTo(map);
      
      marker.bindPopup(`
          <strong>ID:</strong> ${doc.id}<br>
          <strong>Comment:</strong> ${data.comment}<br>
          <img src="${data.imageID}" alt="Thumbnail" style="width:100px;height:auto;">
      `);

      const row = dataBody.insertRow();
      row.insertCell(0).textContent = doc.id;
      row.insertCell(1).textContent = `${data.location.latitude}, ${data.location.longitude}`;
      row.insertCell(2).textContent = data.userName;
      row.insertCell(3).textContent = data.comment;
      const imgCell = row.insertCell(4);
      const img = document.createElement('img');
      img.src = data.imageID;  // 直接ダウンロードURLを使用
      img.style.width = '50px';
      img.style.height = 'auto';
      imgCell.appendChild(img);

      const actionsCell = row.insertCell(5);
      const editBtn = document.createElement('button');
      editBtn.textContent = '編集';
      editBtn.onclick = () => { /* 編集機能を実装する */ };
      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = '削除';
      deleteBtn.onclick = () => deleteMarker(doc.id);
      actionsCell.appendChild(editBtn);
      actionsCell.appendChild(deleteBtn);
  });
}

// マーカーを削除
async function deleteMarker(id) {
  if (confirm('このマーカーを削除しますか？')) {
      try {
          await deleteDoc(doc(db, 'LatLngs', 'Map99', 'Markers', id));
          alert('マーカーが削除されました。');
          loadMarkers();
      } catch (error) {
          console.error("Error removing document: ", error);
          alert('削除に失敗しました。');
      }
  }
}

// 現在地を取得し、マップに表示する関数
function showCurrentLocation() {
  if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(function(position) {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          
          // 緑色のマーカーアイコンを作成
          const greenIcon = new L.Icon({
              iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
              shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
              iconSize: [25, 41],
              iconAnchor: [12, 41],
              popupAnchor: [1, -34],
              shadowSize: [41, 41]
          });

          // 現在地にマーカーを追加
          L.marker([lat, lng], {icon: greenIcon}).addTo(map)
              .bindPopup("あなたの現在地").openPopup();

          // 現在地にマップの中心を移動
          map.setView([lat, lng], 13);
      }, function(error) {
          console.error("Error getting location: ", error);
          alert("現在地を取得できませんでした。");
      });
  } else {
      alert("お使いのブラウザはGeolocation APIをサポートしていません。");
  }
}


// 初期ロード
loadMarkers();