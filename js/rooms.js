// rooms.js

let isEditMode = false;

// ── Image preview helper ─────────────────────────────────────────
function updateImagePreview(src) {
    const wrap = document.getElementById('image-preview-wrap');
    const img  = document.getElementById('image-preview');
    const err  = document.getElementById('image-preview-error');

    if (!src || !src.trim()) {
        wrap.style.display = 'none';
        return;
    }

    wrap.style.display = 'block';
    err.style.display  = 'none';
    img.src = src.trim() + '?v=' + Date.now();

    img.onload  = () => { err.style.display = 'none'; };
    img.onerror = () => { err.style.display = 'block'; };
}
let currentRooms = [];

document.addEventListener('DOMContentLoaded', () => {

    const roomModal = document.getElementById('room-modal');
    const deleteModal = document.getElementById('delete-modal');
    const roomForm = document.getElementById('room-form');

    // Initial Load
    loadRooms();

    // Live image preview when dropdown changes
    document.getElementById('room-image').addEventListener('change', (e) => {
        updateImagePreview(e.target.value);
    });

    // Modal Triggers
    document.getElementById('add-room-btn').addEventListener('click', () => {
        isEditMode = false;
        document.getElementById('modal-title').textContent = 'Add New Room';
        roomForm.reset();
        updateImagePreview('');
        document.getElementById('room-id').value = '';
        roomModal.classList.add('active');
    });

    document.querySelectorAll('.close-modal, .close-modal-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            roomModal.classList.remove('active');
            roomForm.reset();
            updateImagePreview('');
        });
    });

    // Delete Modal Actions
    document.getElementById('cancel-delete-btn').addEventListener('click', () => {
        deleteModal.classList.remove('active');
    });

    document.getElementById('confirm-delete-btn').addEventListener('click', async () => {
        const id = document.getElementById('delete-room-id').value;
        if (id) {
            UI.showLoader();
            try {
                await db.collection('rooms').doc(id).delete();
                UI.showNotification('Room deleted successfully!', 'success');
                deleteModal.classList.remove('active');
                loadRooms();
            } catch (error) {
                UI.showNotification('Error deleting room: ' + error.message, 'error');
            } finally {
                UI.hideLoader();
            }
        }
    });

    // Form Submit (Add/Edit)
    roomForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        UI.showLoader();

        const roomId = document.getElementById('room-id').value;
        const roomData = {
            number: document.getElementById('room-number').value,
            type: document.getElementById('room-type').value,
            status: document.getElementById('room-status').value,
            image: document.getElementById("room-image").value
        };

        try {
            if (isEditMode && roomId) {
                // Update
                await db.collection('rooms').doc(roomId).update(roomData);
                UI.showNotification('Room updated successfully!', 'success');
            } else {
                // Check if room number already exists
                const existing = await db.collection('rooms').where('number', '==', roomData.number).get();
                if (!existing.empty) {
                    UI.hideLoader();
                    UI.showNotification('Room number already exists!', 'error');
                    return;
                }

                // Construct
                await db.collection('rooms').add(roomData);
                UI.showNotification('Room added successfully!', 'success');
            }

            roomModal.classList.remove('active');
            roomForm.reset();
            loadRooms();
        } catch (error) {
            UI.showNotification('Operation failed: ' + error.message, 'error');
        } finally {
            UI.hideLoader();
        }
    });

    // Search functionality
    document.getElementById('search-rooms').addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        const filtered = currentRooms.filter(room => room.number.toLowerCase().includes(term));
        renderRoomsTable(filtered);
    });

});

let _roomsUnsubscribe = null;

function loadRooms() {
    // Unsubscribe any previous listener
    if (_roomsUnsubscribe) _roomsUnsubscribe();

    UI.showLoader();

    _roomsUnsubscribe = db.collection('rooms').onSnapshot(snapshot => {
        currentRooms = [];
        snapshot.forEach(doc => {
            currentRooms.push({ id: doc.id, ...doc.data() });
        });

        // Sort by number
        currentRooms.sort((a, b) => parseInt(a.number) - parseInt(b.number));
        renderRoomsTable(currentRooms);
        UI.hideLoader();
    }, error => {
        console.error('[Rooms] Real-time listener error:', error);
        UI.showNotification('Error loading rooms', 'error');
        UI.hideLoader();
    });
}

function renderRoomsTable(rooms) {
    const tbody = document.getElementById('rooms-table-body');
    tbody.innerHTML = '';

    if (rooms.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-light);">No rooms found. Add some rooms to get started.</td></tr>';
        return;
    }

    rooms.forEach(room => {
        const tr = document.createElement('tr');

        let badgeClass = 'badge-secondary';
        const st = (room.status || '').toLowerCase();
        if (st === 'available') badgeClass = 'badge-success';
        else if (st === 'occupied') badgeClass = 'badge-danger';
        else if (st === 'reserved') badgeClass = 'badge-warning';
        else if (st === 'maintenance') badgeClass = 'badge-info';

        tr.innerHTML = `
            <td><strong>${room.number}</strong></td>
            <td>${room.type || 'Standard'}</td>
            <td><span class="badge ${badgeClass}">${room.status || 'Available'}</span></td>
            <td>
                <button class="btn btn-sm btn-outline edit-btn" data-id="${room.id}" title="Edit Room">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="btn btn-sm btn-outline delete-btn" data-id="${room.id}" style="color: var(--status-occupied); margin-left: 8px;" title="Delete Room">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    // Attach event listeners to dynamic buttons
    document.querySelectorAll('.edit-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.getAttribute('data-id');
            const room = currentRooms.find(r => r.id === id);
            if (room) {
                document.getElementById('modal-title').textContent = 'Edit Room';
                document.getElementById('room-id').value = room.id;
                document.getElementById('room-number').value = room.number;
                document.getElementById('room-type').value = room.type;
                document.getElementById('room-status').value = room.status;
                isEditMode = true;
                document.getElementById('room-modal').classList.add('active');

                const imgVal = room.image || '';
                console.log('Stored image value:', imgVal);
                setTimeout(() => {
                    document.getElementById('room-image').value = imgVal;
                    updateImagePreview(imgVal);
                }, 50);
            }
        });
    });

    document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.getAttribute('data-id');
            document.getElementById('delete-room-id').value = id;
            document.getElementById('delete-modal').classList.add('active');
        });
    });
}
