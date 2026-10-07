-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT,
    "passwordHash" TEXT,
    "role" TEXT NOT NULL DEFAULT 'VIEWER',
    "displayName" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#f97316',
    "isKids" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "lastLoginAt" DATETIME
);

-- CreateTable
CREATE TABLE "AdminSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    CONSTRAINT "AdminSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Genre" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Movie" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "sortTitle" TEXT NOT NULL,
    "originalTitle" TEXT,
    "year" INTEGER,
    "overview" TEXT,
    "tagline" TEXT,
    "cast" TEXT NOT NULL DEFAULT '[]',
    "director" TEXT,
    "rating" REAL,
    "contentRating" TEXT,
    "posterImage" TEXT,
    "backdropImage" TEXT,
    "accent" TEXT NOT NULL DEFAULT '#f97316',
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "metadataLocked" BOOLEAN NOT NULL DEFAULT false,
    "playCount" INTEGER NOT NULL DEFAULT 0,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Series" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "sortTitle" TEXT NOT NULL,
    "year" INTEGER,
    "overview" TEXT,
    "cast" TEXT NOT NULL DEFAULT '[]',
    "rating" REAL,
    "contentRating" TEXT,
    "posterImage" TEXT,
    "backdropImage" TEXT,
    "accent" TEXT NOT NULL DEFAULT '#6366f1',
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "metadataLocked" BOOLEAN NOT NULL DEFAULT false,
    "playCount" INTEGER NOT NULL DEFAULT 0,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Season" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "seriesId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT,
    "overview" TEXT,
    "posterImage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Season_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Episode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "seriesId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "overview" TEXT,
    "airDate" DATETIME,
    "thumbImage" TEXT,
    "metadataLocked" BOOLEAN NOT NULL DEFAULT false,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Episode_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Episode_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VideoFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "folderId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "relPath" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "mtimeMs" REAL NOT NULL,
    "container" TEXT,
    "durationSec" REAL NOT NULL DEFAULT 0,
    "width" INTEGER,
    "height" INTEGER,
    "videoCodec" TEXT,
    "videoProfile" TEXT,
    "pixFmt" TEXT,
    "bitDepth" INTEGER,
    "audioCodec" TEXT,
    "bitrate" INTEGER,
    "fps" REAL,
    "thumbImage" TEXT,
    "missing" BOOLEAN NOT NULL DEFAULT false,
    "probeError" TEXT,
    "probedAt" DATETIME,
    "movieId" TEXT,
    "episodeId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VideoFile_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "MediaFolder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "VideoFile_movieId_fkey" FOREIGN KEY ("movieId") REFERENCES "Movie" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "VideoFile_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Subtitle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "videoFileId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "streamIndex" INTEGER,
    "path" TEXT,
    "format" TEXT NOT NULL,
    "language" TEXT,
    "label" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "forced" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Subtitle_videoFileId_fkey" FOREIGN KEY ("videoFileId") REFERENCES "VideoFile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AudioTrack" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "videoFileId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "streamIndex" INTEGER NOT NULL,
    "codec" TEXT NOT NULL,
    "language" TEXT,
    "title" TEXT,
    "channels" INTEGER,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "AudioTrack_videoFileId_fkey" FOREIGN KEY ("videoFileId") REFERENCES "VideoFile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WatchHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "videoFileId" TEXT NOT NULL,
    "sessionId" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    "positionSec" REAL NOT NULL DEFAULT 0,
    "durationSec" REAL NOT NULL DEFAULT 0,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "WatchHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WatchHistory_videoFileId_fkey" FOREIGN KEY ("videoFileId") REFERENCES "VideoFile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContinueWatching" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "videoFileId" TEXT NOT NULL,
    "movieId" TEXT,
    "seriesId" TEXT,
    "episodeId" TEXT,
    "positionSec" REAL NOT NULL,
    "durationSec" REAL NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ContinueWatching_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ContinueWatching_videoFileId_fkey" FOREIGN KEY ("videoFileId") REFERENCES "VideoFile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ContinueWatching_movieId_fkey" FOREIGN KEY ("movieId") REFERENCES "Movie" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ContinueWatching_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ContinueWatching_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Playlist" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Playlist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PlaylistItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "playlistId" TEXT NOT NULL,
    "movieId" TEXT,
    "seriesId" TEXT,
    "episodeId" TEXT,
    "position" INTEGER NOT NULL,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlaylistItem_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlaylistItem_movieId_fkey" FOREIGN KEY ("movieId") REFERENCES "Movie" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlaylistItem_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlaylistItem_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Favorite" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "movieId" TEXT,
    "seriesId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Favorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Favorite_movieId_fkey" FOREIGN KEY ("movieId") REFERENCES "Movie" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Favorite_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ServerSetting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MediaFolder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "path" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'mixed',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastScannedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ScanJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "folderId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "full" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "filesSeen" INTEGER NOT NULL DEFAULT 0,
    "filesAdded" INTEGER NOT NULL DEFAULT 0,
    "filesUpdated" INTEGER NOT NULL DEFAULT 0,
    "filesRemoved" INTEGER NOT NULL DEFAULT 0,
    "filesFailed" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScanJob_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "MediaFolder" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "_GenreToMovie" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_GenreToMovie_A_fkey" FOREIGN KEY ("A") REFERENCES "Genre" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_GenreToMovie_B_fkey" FOREIGN KEY ("B") REFERENCES "Movie" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "_GenreToSeries" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_GenreToSeries_A_fkey" FOREIGN KEY ("A") REFERENCES "Genre" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_GenreToSeries_B_fkey" FOREIGN KEY ("B") REFERENCES "Series" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE UNIQUE INDEX "AdminSession_tokenHash_key" ON "AdminSession"("tokenHash");

-- CreateIndex
CREATE INDEX "AdminSession_userId_idx" ON "AdminSession"("userId");

-- CreateIndex
CREATE INDEX "AdminSession_expiresAt_idx" ON "AdminSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Genre_name_key" ON "Genre"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Genre_slug_key" ON "Genre"("slug");

-- CreateIndex
CREATE INDEX "Movie_sortTitle_year_idx" ON "Movie"("sortTitle", "year");

-- CreateIndex
CREATE INDEX "Movie_year_idx" ON "Movie"("year");

-- CreateIndex
CREATE INDEX "Movie_addedAt_idx" ON "Movie"("addedAt");

-- CreateIndex
CREATE INDEX "Movie_playCount_idx" ON "Movie"("playCount");

-- CreateIndex
CREATE INDEX "Movie_featured_idx" ON "Movie"("featured");

-- CreateIndex
CREATE UNIQUE INDEX "Series_sortTitle_key" ON "Series"("sortTitle");

-- CreateIndex
CREATE INDEX "Series_year_idx" ON "Series"("year");

-- CreateIndex
CREATE INDEX "Series_addedAt_idx" ON "Series"("addedAt");

-- CreateIndex
CREATE INDEX "Series_playCount_idx" ON "Series"("playCount");

-- CreateIndex
CREATE UNIQUE INDEX "Season_seriesId_number_key" ON "Season"("seriesId", "number");

-- CreateIndex
CREATE INDEX "Episode_seriesId_idx" ON "Episode"("seriesId");

-- CreateIndex
CREATE INDEX "Episode_addedAt_idx" ON "Episode"("addedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Episode_seasonId_number_key" ON "Episode"("seasonId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "VideoFile_path_key" ON "VideoFile"("path");

-- CreateIndex
CREATE INDEX "VideoFile_folderId_idx" ON "VideoFile"("folderId");

-- CreateIndex
CREATE INDEX "VideoFile_movieId_idx" ON "VideoFile"("movieId");

-- CreateIndex
CREATE INDEX "VideoFile_episodeId_idx" ON "VideoFile"("episodeId");

-- CreateIndex
CREATE INDEX "VideoFile_missing_idx" ON "VideoFile"("missing");

-- CreateIndex
CREATE INDEX "Subtitle_videoFileId_idx" ON "Subtitle"("videoFileId");

-- CreateIndex
CREATE UNIQUE INDEX "AudioTrack_videoFileId_index_key" ON "AudioTrack"("videoFileId", "index");

-- CreateIndex
CREATE INDEX "WatchHistory_userId_startedAt_idx" ON "WatchHistory"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "WatchHistory_videoFileId_idx" ON "WatchHistory"("videoFileId");

-- CreateIndex
CREATE UNIQUE INDEX "WatchHistory_userId_sessionId_key" ON "WatchHistory"("userId", "sessionId");

-- CreateIndex
CREATE INDEX "ContinueWatching_userId_updatedAt_idx" ON "ContinueWatching"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "ContinueWatching_seriesId_idx" ON "ContinueWatching"("seriesId");

-- CreateIndex
CREATE UNIQUE INDEX "ContinueWatching_userId_videoFileId_key" ON "ContinueWatching"("userId", "videoFileId");

-- CreateIndex
CREATE UNIQUE INDEX "Playlist_userId_name_key" ON "Playlist"("userId", "name");

-- CreateIndex
CREATE INDEX "PlaylistItem_playlistId_position_idx" ON "PlaylistItem"("playlistId", "position");

-- CreateIndex
CREATE INDEX "Favorite_userId_createdAt_idx" ON "Favorite"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Favorite_userId_movieId_key" ON "Favorite"("userId", "movieId");

-- CreateIndex
CREATE UNIQUE INDEX "Favorite_userId_seriesId_key" ON "Favorite"("userId", "seriesId");

-- CreateIndex
CREATE UNIQUE INDEX "MediaFolder_path_key" ON "MediaFolder"("path");

-- CreateIndex
CREATE INDEX "ScanJob_createdAt_idx" ON "ScanJob"("createdAt");

-- CreateIndex
CREATE INDEX "ScanJob_status_idx" ON "ScanJob"("status");

-- CreateIndex
CREATE UNIQUE INDEX "_GenreToMovie_AB_unique" ON "_GenreToMovie"("A", "B");

-- CreateIndex
CREATE INDEX "_GenreToMovie_B_index" ON "_GenreToMovie"("B");

-- CreateIndex
CREATE UNIQUE INDEX "_GenreToSeries_AB_unique" ON "_GenreToSeries"("A", "B");

-- CreateIndex
CREATE INDEX "_GenreToSeries_B_index" ON "_GenreToSeries"("B");
