import { firebaseConfig } from './config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getFirestore, collection, doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc, GeoPoint, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";


const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let map = L.map('map').setView([33.98353710, 131.2984133], 13); //宇部市新都市周辺を初期ビューにする
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

let markers = {};
let previewMarker = null;

document.getElementById('displayMarkers').addEventListener('click', loadMarkers);

async function loadMarkers() {
  const mapSelect = document.getElementById('mapSelect');
  const selectedMap = mapSelect.value;
  if (!selectedMap) {
    alert('マップを選択してください。');
    return;
  }

  // マーカーをクリア
  Object.values(markers).forEach(marker => map.removeLayer(marker));
  markers = {};

  // マーカーを読み込んで表示
  const querySnapshot = await getDocs(collection(db, 'LatLngs', selectedMap, 'markers'));
  querySnapshot.forEach((doc) => {
    const data = doc.data();
    const marker = L.marker([data.Location.latitude, data.Location.longitude])
      .addTo(map)
      .bindPopup(`<b>${data.userName}</b><br>${data.Comment}<br>ID: ${doc.id}`);
    markers[doc.id] = marker;
  });

  // マーカーが追加されたことを通知
  alert(`${querySnapshot.size}個のマーカーを表示しました。`);
}

const mapSelect = document.getElementById('mapSelect');
for (let i = 1; i <= 20; i++) {
  let option = document.createElement('option');
  option.value = `Map${i.toString().padStart(2, '0')}`;
  option.textContent = `Map ${i}`;
  mapSelect.appendChild(option);
}

// mapSelect.addEventListener('change', loadMarkers);

map.on('click', function (e) {
  if (previewMarker) {
    map.removeLayer(previewMarker);
  }
  previewMarker = L.marker(e.latlng, {
    icon: L.icon({
      iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
      shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
      iconSize: [25, 41],
      iconAnchor: [12, 41],
      popupAnchor: [1, -34],
      shadowSize: [41, 41]
    })
  }).addTo(map);

  document.getElementById('selectedLocation').textContent = `選択された位置: ${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)}`;
});

document.getElementById('addMarker').addEventListener('click', async () => {
  const userName = document.getElementById('userName').value;
  const comment = document.getElementById('comment').value;
  const selectedMap = mapSelect.value;

  if (!selectedMap || !userName || !comment || !previewMarker) {
    alert('すべてのフィールドを入力し、地図上で位置を選択してください。');
    return;
  }

  const newMarker = {
    Comment: comment,
    CreatedAt: serverTimestamp(),
    Location: new GeoPoint(previewMarker.getLatLng().lat, previewMarker.getLatLng().lng),
    updatedAt: serverTimestamp(),
    userName: userName
  };

  const newId = await getNextId(selectedMap);
  const markerRef = doc(db, 'LatLngs', selectedMap, 'markers', newId.toString());
  await setDoc(markerRef, newMarker);
  alert('マーカーが追加されました。ID: ' + newId);

  map.removeLayer(previewMarker);
  previewMarker = null;
  document.getElementById('selectedLocation').textContent = '選択された位置: まだ選択されていません';

  loadMarkers();
});

async function getNextId(mapName) {
  const querySnapshot = await getDocs(collection(db, 'LatLngs', mapName, 'markers'));
  const existingIds = querySnapshot.docs.map(doc => parseInt(doc.id)).filter(id => !isNaN(id));
  return existingIds.length > 0 ? Math.max(...existingIds) + 1 : 1;
}

document.getElementById('deleteMarker').addEventListener('click', async () => {
  const deleteId = document.getElementById('deleteId').value;
  const selectedMap = mapSelect.value;

  if (!selectedMap || !deleteId) {
    alert('マップとIDを選択してください。');
    return;
  }

  await deleteDoc(doc(db, 'LatLngs', selectedMap, 'markers', deleteId));
  alert('マーカーが削除されました。');
  loadMarkers();
});

document.getElementById('updateMarker').addEventListener('click', async () => {
  const updateId = document.getElementById('updateId').value;
  const updateComment = document.getElementById('updateComment').value;
  const selectedMap = mapSelect.value;

  if (!selectedMap || !updateId || !updateComment) {
    alert('マップ、ID、新しいコメントを入力してください。');
    return;
  }

  const markerRef = doc(db, 'LatLngs', selectedMap, 'markers', updateId);
  await updateDoc(markerRef, {
    Comment: updateComment,
    updatedAt: serverTimestamp()
  });
  alert('マーカーが更新されました。');
  loadMarkers();
});