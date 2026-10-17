/* js/portal-config.js – 
GTEC Guest Lodge – portal configuration.
   This is the ONLY file you normally need to edit for the client portal:
   Firebase keys, page paths, check-in/out times, house rules, services and
   the field names your existing `bookings` / `rooms` documents use. */
window.PORTAL = {

  /* 1. Same firebaseConfig you already use in js/firebase.js (these keys are public by design). */
  firebaseConfig: {
    apiKey: "AIzaSyAWEF_WEDqMTQAP61zmqTyMN-AK43OWoT4",
    authDomain: "guesthousesystem-86fdc.firebaseapp.com",
    projectId: "guesthousesystem-86fdc",
    storageBucket: "guesthousesystem-86fdc.firebasestorage.app",
    messagingSenderId: "482448753298",
    appId: "1:482448753298:web:e3e17de5bbf0f268121c4b",
    measurementId: "G-1YGYCD1M28"
},

  /* 2. Lodge details shown in the portal */
  lodge: {
    name: 'GTEC Guest Lodge',
    city: 'Accra, Ghana',
    phone: '+233 54 203 6651',           // front desk, shown under Rules → Contacts
    whatsapp: '233542036651',            // digits only, no +  (used for wa.me link)
    email: 'hospitality@gtec.edu.gh',
    checkInTime: '12:00',                // 24h format (matches the website's 12:00 check-in)
    checkOutTime: '12:00',
    currency: 'GH₵'
  },

  /* 3. Page paths (relative to site root) */
  paths: {
    home: 'index.html',
    book: 'index.html#rooms',            // where "Book a room" sends people
    signin: 'signin.html',
    signup: 'signup.html',
    account: 'account.html'
  },

  /* 4. Where your existing booking / room data lives */
  data: {
    bookings: {
      collection: 'guests',
      // Bookings are matched to the signed-in guest by e-mail. These are the
      // field names tried, in order. Add 'emailLower' to new bookings (see PORTAL_SETUP.md).
      emailFields: ['emailLower', 'email'],
      // Candidate field names for each value. Put your real names first if they differ.
      fields: {
        ref: ['idNumber', 'bookingId', 'ref', 'reference', 'code'],
        room: ['roomNumber', 'roomName', 'room', 'roomType', 'roomTitle'],
        checkIn: ['checkinDate', 'checkIn', 'checkin', 'check_in', 'arrival', 'startDate', 'from'],
        checkOut: ['checkoutDate', 'checkOut', 'checkout', 'check_out', 'departure', 'endDate', 'to'],
        status: ['status', 'bookingStatus'],
        guests: ['guestsCount', 'guests', 'numGuests', 'adults'],
        total: ['total', 'totalAmount', 'amount', 'price']
      }
    },
    rooms: {
      collection: 'rooms',
      fields: {
        name: ['name', 'title', 'roomName', 'type'],
        price: ['price', 'pricePerNight', 'rate', 'nightlyRate'],
        capacity: ['capacity', 'maxGuests', 'guests', 'sleeps'],
        image: ['image', 'imageUrl', 'photo', 'img', 'images'],      // string, or array (first used)
        amenities: ['amenities', 'features', 'facilities'],           // array of strings
        description: ['description', 'desc', 'details'],
        available: ['available', 'isAvailable', 'active']             // boolean; omit if you don't keep one
      }
    }
  },

  /* 5. Fault reports */
  fault: {
    categories: ['Air conditioning', 'Electricity / lighting', 'Water / plumbing', 'Wi-Fi / TV', 'Furniture / fittings', 'Cleanliness', 'Noise', 'Security', 'Other'],
    urgencies: ['Low', 'Normal', 'Urgent']
  },

  /* 6. Laundry */
  laundry: {
    items: ['Shirts / tops', 'Trousers / skirts', 'Dresses', 'Underwear / socks', 'Bedding / towels', 'Other'],
    services: ['Wash & fold', 'Wash & iron', 'Iron only', 'Dry clean'],
    slots: ['Morning (8am – 12pm)', 'Afternoon (12pm – 5pm)', 'Evening (5pm – 8pm)'],
    note: 'Prices are confirmed by the front desk after collection.'
  },

  /* 7. House rules – edit freely. Each group becomes an expandable section. */
  rules: [
    { title: 'Check-in & check-out', items: [
      'Check-in is from 2:00 pm and check-out is by 12:00 noon.',
      'Early check-in or late check-out depends on availability – please ask the front desk.',
      'A valid photo ID is required at check-in.'
    ] },
    { title: 'Quiet hours & visitors', items: [
      'Quiet hours are 10:00 pm to 6:00 am.',
      'Visitors are welcome in the reception area until 9:00 pm. Overnight visitors must be registered at the front desk.'
    ] },
    { title: 'In your room', items: [
      'Smoking and illegal substances are not permitted anywhere on the premises.',
      'Please switch off lights, air-conditioning and taps when leaving the room.',
      'Cooking and the use of personal heaters or irons is not allowed in rooms.'
    ] },
    { title: 'Damage, loss & safety', items: [
      'Guests are responsible for damage to the room or its contents during their stay.',
      'Please keep valuables with you or ask the front desk about safe storage.',
      'Report any fault, safety concern or suspicious activity to the front desk immediately.'
    ] },
    { title: 'Payments & cancellations', items: [
      'The balance of your stay is due at check-in unless agreed otherwise.',
      'Cancellations and refunds follow the policy shown at the time of booking.'
    ] }
  ],

  /* 8. Services – shown on the Services page. (An optional Firestore `services` collection overrides this list.) */
  services: [
    { icon: '🧺', name: 'Laundry', text: 'Wash, iron and dry-clean. Request it from your account and we collect from your room.' },
    { icon: '📶', name: 'Free Wi-Fi', text: 'High-speed internet in every room and the lounge.' },
    { icon: '🍳', name: 'Breakfast', text: 'Served daily in the dining area. Ask the front desk about times and menu.' },
    { icon: '🚕', name: 'Airport transfer', text: 'Pick-up and drop-off can be arranged with a day’s notice.' },
    { icon: '🧹', name: 'Housekeeping', text: 'Daily room cleaning. Tell us if you want extra towels or a do-not-disturb day.' },
    { icon: '🔒', name: '24-hour security', text: 'Attendant on duty and secure parking on the premises.' },
    { icon: '🛎️', name: 'Front desk', text: 'Staffed round the clock for directions, bookings and any help you need.' }
  ]
};
