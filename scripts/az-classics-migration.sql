-- Create az_classic_movies table
CREATE TABLE IF NOT EXISTS az_classic_movies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  year INT NOT NULL,
  synopsis TEXT,
  genre TEXT,
  poster_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create az_classic_cast table
CREATE TABLE IF NOT EXISTS az_classic_cast (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  movie_id UUID NOT NULL REFERENCES az_classic_movies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  character TEXT,
  photo_url TEXT,
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create az_classic_crew table
CREATE TABLE IF NOT EXISTS az_classic_crew (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  movie_id UUID NOT NULL REFERENCES az_classic_movies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  photo_url TEXT,
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indices for performance
CREATE INDEX IF NOT EXISTS idx_az_classic_cast_movie_id ON az_classic_cast(movie_id, display_order);
CREATE INDEX IF NOT EXISTS idx_az_classic_crew_movie_id ON az_classic_crew(movie_id, display_order);

-- Enable RLS (Row Level Security)
ALTER TABLE az_classic_movies ENABLE ROW LEVEL SECURITY;
ALTER TABLE az_classic_cast ENABLE ROW LEVEL SECURITY;
ALTER TABLE az_classic_crew ENABLE ROW LEVEL SECURITY;

-- Create public read-only policies
CREATE POLICY "Allow public read az_classic_movies" ON az_classic_movies
  FOR SELECT
  USING (true);

CREATE POLICY "Allow public read az_classic_cast" ON az_classic_cast
  FOR SELECT
  USING (true);

CREATE POLICY "Allow public read az_classic_crew" ON az_classic_crew
  FOR SELECT
  USING (true);

-- Create storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('az-classics', 'az-classics', true)
ON CONFLICT (id) DO NOTHING;

-- Create public read policy for storage
CREATE POLICY "Allow public read az-classics bucket" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'az-classics');
