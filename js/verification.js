// verification.js
let verifiedGuest = null;

document.getElementById("verify-btn").addEventListener("click", async () => {

    const name = document.getElementById("verify-name").value.trim().toLowerCase();
    const id = document.getElementById("verify-id").value.trim().toUpperCase();

    const resultDiv = document.getElementById("verify-result");
    const checkinBtn = document.getElementById("checkin-btn");

    resultDiv.innerHTML = "Verifying...";
    checkinBtn.style.display = "none";

    try {

        const snapshot = await db.collection("guests")
            .where("idNumber", "==", id)
            .get();

        if (snapshot.empty) {
            resultDiv.innerHTML = `<p style="color:red;">❌ Guest not found</p>`;
            return;
        }

        const doc = snapshot.docs[0];
        const guest = { id: doc.id, ...doc.data() };

        if ((guest.name || "").toLowerCase() !== name) {
            resultDiv.innerHTML = `<p style="color:red;">❌ Name does not match ID</p>`;
            return;
        }

        verifiedGuest = guest;

        resultDiv.innerHTML = `
            <p style="color:green;">✅ Verified</p>
            <p><strong>${guest.name}</strong></p>
            <p>Room: ${guest.roomNumber || guest.room}</p>
        `;

        checkinBtn.style.display = "block";

    } catch (error) {
        console.error("Verification error:", error);
        resultDiv.innerHTML = `<p style="color:red;">Error verifying guest</p>`;
    }

});