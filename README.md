# StreamBox 📺

Your ultimate streaming companion — discover, watch, and track thousands of movies and series with personalized recommendations and detailed insights.

StreamBox is a high-performance streaming application built with React Native and Expo. It features a modern, cinematic UI with smooth animations and integrated movie/series data.

## 🚀 Features

- **Cinematic UI:** Beautifully designed interface with glassmorphism and smooth transitions.
- **Movies & Series:** Extensive library powered by TMDB API.
- **Advanced Player:** Custom video player with support for multiple sources.
- **User Sync:** Watchlist and favorites synced via Supabase.
- **Personalized Experience:** Taste profiles and recommendations.

## 🛠️ Tech Stack

- **Framework:** [React Native](https://reactnative.dev/) + [Expo](https://expo.dev/)
- **Styling:** [styled-components](https://styled-components.com/)
- **State Management:** React Context API
- **Backend:** [Supabase](https://supabase.com/)
- **Data Source:** [TMDB API](https://www.themoviedb.org/documentation/api)

## 📦 Getting Started

### Prerequisites

- Node.js (v18+)
- npm or yarn
- Expo Go app on your mobile device (for testing)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/MammadovEshgin/Streambox.git
   cd Streambox
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:
   Create a `.env` file in the root directory and add your keys (see `.env.example`):
   ```env
   EXPO_PUBLIC_TMDB_API_KEY=your_tmdb_key
   EXPO_PUBLIC_SUPABASE_URL=your_supabase_url
   EXPO_PUBLIC_SUPABASE_ANON_KEY=your_supabase_key
   ```

4. Start the project:
   ```bash
   npm start
   ```

## 📜 License

This project is private. All rights reserved.
