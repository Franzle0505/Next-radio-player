import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { formatDateToMySQL } from "@/lib/utils";
import moment from 'moment';
import path from "path";
import { existsSync } from "fs";
import { unlink } from "fs/promises";

const formatDateParam = (input) => {
  return input < 10 ? `0${input}` : input;
};

// To handle a GET request to /api/station/[stationId]
export async function GET(request, { params }) {
  const { stationId, offset } = params;

  const url = new URL(request.url);
  const month = url.searchParams.get("month");
  const year = url.searchParams.get("year");
  const getAll = url.searchParams.get("getAll");

  const userOffset = url.searchParams.get("offset");

    if (!userOffset) {
      throw new Error("Offset parameter is required");
    }

    // Convert offset to hours
    const offsetInHours = parseInt(userOffset, 10) / 60;

  // Parse the request URL to get the query parameters
  
  
  if (!getAll) {
    if (!month || !year) {
      return NextResponse.json(
        { error: "Month and year parameters are required" },
        { status: 400 }
      );
    }
  }

  try {
    if (getAll) {
      // Execute SQL query to fetch all the scheduled tracks from the database for the station
      const tracks = await query(
        `SELECT * FROM scheduled_tracks WHERE stationId = ? order by dateScheduled ASC`,
        [stationId]
      );
      // Return the fetched tracks
      return NextResponse.json(tracks, { status: 200 });
    } else {
      // Execute SQL query to fetch the scheduled tracks from the database for the current month and get count of tracks for each day
      const tracks = await query(
        `
        SELECT 
          DAY(DATE_ADD(dateScheduled, INTERVAL - ${offsetInHours} HOUR)) as day, 
          COUNT(*) as count 
        FROM scheduled_tracks 
        WHERE stationId = ? 
          AND MONTH(DATE_ADD(dateScheduled, INTERVAL - ${offsetInHours} HOUR)) = ? 
          AND YEAR(DATE_ADD(dateScheduled, INTERVAL - ${offsetInHours} HOUR)) = ? 
        GROUP BY DAY(DATE_ADD(dateScheduled, INTERVAL - ${offsetInHours} HOUR))
        `,
        [stationId, month, year]
      );

      const transformedData = tracks.map((track) => {
        return {
          title: `${track.count} - Track${track.count > 1 ? "s" : ""}`,
          date: `${year}-${formatDateParam(month)}-${formatDateParam(track.day)}`,
        };
      });

      // Return the fetched tracks
      return NextResponse.json(transformedData, { status: 200 });
    }
  } catch (error) {
    // Return error if any
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

function generateUniqueVarchar20() {
  return Math.random().toString(36).substr(2, 9) + Date.now().toString(36).substr(-11);
}

export function addEventsBetweenDates(formData) {
  console.log(formData)
  const isUpdate = formData.get("_method") === "PUT";
  const repeat = formData.get("repeat") !== "false";
  const period = formData.get("period"); // Either 'daily' or 'monthly'

  const daysOfWeek = {
    Sunday: 0,
    Monday: 1,
    Tuesday: 2,
    Wednesday: 3,
    Thursday: 4,
    Friday: 5,
    Saturday: 6,
  };

  // Collect selected days of the week (for daily scheduling)
  const selectedDays = Object.keys(daysOfWeek).filter(
    (day) => formData.get(day) === "true"
  );

  // Collect selected days of the month (for monthly scheduling)
  const selectedDaysOfMonth = Array.from({ length: 31 }, (_, i) => `${i + 1}`).filter(
    (day) => formData.get(day) === "true"
  );

  const includeLastDay = formData.get("Last Day") === "true";

  const start = moment(formData.get("dateScheduled"));
  const end = repeat && formData.get("dateScheduledEnd") ? moment(formData.get("dateScheduledEnd")) : start;

  const eventsArray = [];
  let groupId = generateUniqueVarchar20();

  // Iterate through the date range
  for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
    if (isUpdate && date.toISOString() === start.toISOString()) continue; // Skip first iteration for updates

    if (period === "daily") {
      // Daily: Check if the current day matches the selected days
      if (selectedDays.length === 0 || selectedDays.includes(Object.keys(daysOfWeek).find(day => daysOfWeek[day] === date.getDay()))) {
        eventsArray.push(generateEventEntry(date, formData, groupId));
      }
    } else if (period === "monthly") {
      // Monthly: Check if the current day matches the selected days of the month
      const dayOfMonth = date.getDate();
      const isLastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate() === dayOfMonth;

      if (
        selectedDaysOfMonth.includes(`${dayOfMonth}`) ||
        (includeLastDay && isLastDay)
      ) {
        eventsArray.push(generateEventEntry(date, formData, groupId));
      }
    }
  }

  return eventsArray.join(", ");
}

// Helper function to generate an event entry
function generateEventEntry(date, formData, groupId) {

  const values = [
    formData.get("stationId"),
    groupId,
    formData.get("trackId"),
    formData.get("artistId"),
    formData.get("trackName"),
    formData.get("artistName"),
    formData.get("trackViewUrl"),
    formData.get("artworkURL"),
    formatDateToMySQL(new Date(date)),
  ];

  // Apply escaping to all values
  return `(${values.map((value) => `'${escapeString(value)}'`).join(", ")})`;
}


// To handle a POST request to /api/station/[stationId]/schedule
export async function POST(request, { params }) {
  try {
    const formData = await request.formData();
    if (formData.get("_method") === "DELETE") {
      const trackId = formData.get("trackId");
      return await deleteTrack(trackId);
    }
    if (formData.get("_method") === "DELETEGROUP") {
      const trackId = formData.get("trackId");
      return await deleteGroup(trackId);
    }
    if (formData.get("_method") === "DELETEALL") {
      const stationId = formData.get("stationId");
      return await deleteAllTracks(stationId);
    }
    const isUpdate = formData.get("_method") === "PUT";
    if (isUpdate) {
      
      
      const sqlUPDATE = `UPDATE scheduled_tracks 
        SET 
          stationId = '${escapeString(formData.get("stationId"))}', 
          trackId = '${escapeString(formData.get("trackId"))}', 
          artistId = '${escapeString(formData.get("artistId"))}', 
          trackName = '${escapeString(formData.get("trackName"))}', 
          artistName = '${escapeString(formData.get("artistName"))}', 
          trackViewUrl = '${escapeString(formData.get("trackViewUrl"))}', 
          artworkURL = '${escapeString(formData.get("artworkURL"))}', 
          dateScheduled = '${escapeString(formData.get("dateScheduled"))}' 
        WHERE id = '${escapeString(formData.get("id"))}'`;
      
      const resultUPDATE = await query(sqlUPDATE);
      
      if (resultUPDATE.error) {
        console.log(resultUPDATE.error);
        return NextResponse.json({ error: resultUPDATE.error }, { status: 400 });
      }
    }

    const events = addEventsBetweenDates(formData);
    const sql = `INSERT INTO scheduled_tracks (stationId, groupId, trackId, artistId, trackName, artistName, trackViewUrl, artworkURL, dateScheduled) VALUES ${events}`;
    const result = (events) && await query(sql);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    // get the inserted track
    const track = await query("SELECT * FROM scheduled_tracks WHERE id = ?", [
      result.insertId || formData.get("id"),
    ]);
    return NextResponse.json(track[0], { status: 200 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
const escapeString = (value) => {
  if (typeof value !== "string") return value; // If not a string, return as-is
  return value.replace(/'/g, "''"); // Escape single quotes by replacing with double single quotes
};
async function deleteTrack(trackId) {
  try {
    if (!trackId) {
      return NextResponse.json(
        { error: "Track ID is required" },
        { status: 400 }
      );
    }

    const track = await query("SELECT * FROM scheduled_tracks WHERE id = ?", [
      trackId,
    ]);
    if (!track.length) {
      return NextResponse.json({ error: "Track not found" }, { status: 404 });
    }
    if (track.length === 1) {
      if (track[0].artworkURL) {
        const filePath = path.join(
          process.cwd(),
          "public",
          "schedule",
          track[0].artworkURL.split("/").pop()
        );

        if (existsSync(filePath)) {
          await unlink(filePath);
        }
      }
    }


    let queryStr = "DELETE FROM scheduled_tracks WHERE id = ?";
    let params = [trackId];


    if (!queryStr) {
      return NextResponse.json({ error: 'Could not delete track/s' }, { status: 400 });
    }
    // Execute SQL query to delete the track from the database
    const result = await query(queryStr, params);

    // Return the result of the delete operation
    return NextResponse.json(
      { message: "Track deleted successfully", result },
      { status: 200 }
    );
  } catch (error) {
    // Return error if any
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
// To handle a DELETE request to /api/station/[stationId]/schedule
async function deleteGroup(trackId) {
  try {
    if (!trackId) {
      return NextResponse.json(
        { error: "Track ID is required" },
        { status: 400 }
      );
    }

    const track = await query("SELECT * FROM scheduled_tracks WHERE id = ?", [
      trackId,
    ]);
    if (!track.length) {
      return NextResponse.json({ error: "Track not found" }, { status: 404 });
    }

    if (track[0].artworkURL) {
      const filePath = path.join(
        process.cwd(),
        "public",
        "schedule",
        track[0].artworkURL.split("/").pop()
      );

      if (existsSync(filePath)) {
        await unlink(filePath);
      }
    }
    let queryStr = null;
    let params = null;

    if (track[0].groupId != null) {
      let groupId = track[0].groupId;
      queryStr = "DELETE FROM scheduled_tracks WHERE groupId = ?";
      params = [groupId];
    } else {
      queryStr = "DELETE FROM scheduled_tracks WHERE id = ?";
      params = [trackId];
    }

    if (!queryStr) {
      return NextResponse.json({ error: 'Could not delete track/s' }, { status: 400 });
    }
    // Execute SQL query to delete the track from the database
    const result = await query(queryStr, params);

    // Return the result of the delete operation
    return NextResponse.json(
      { message: "Track deleted successfully", result },
      { status: 200 }
    );
  } catch (error) {
    // Return error if any
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

async function deleteAllTracks(stationId) {
  try {
    if (!stationId) {
      return NextResponse.json(
        { error: "Station ID is required" },
        { status: 400 }
      );
    }

    // Fetch all tracks for the station
    const tracks = await query(
      "SELECT * FROM scheduled_tracks WHERE stationId = ?",
      [stationId]
    );

    if (!tracks.length) {
      return NextResponse.json(
        { error: "No tracks found for the specified station" },
        { status: 404 }
      );
    }

    // Delete associated artwork files if they exist
    for (const track of tracks) {
      if (track.artworkURL) {
        const filePath = path.join(
          process.cwd(),
          "public",
          "schedule",
          track.artworkURL.split("/").pop()
        );

        if (existsSync(filePath)) {
          await unlink(filePath);
        }
      }
    }

    // Execute SQL query to delete all tracks for the station
    const result = await query(
      "DELETE FROM scheduled_tracks WHERE stationId = ?",
      [stationId]
    );

    // Return success response
    return NextResponse.json(
      { message: "All tracks deleted successfully", result },
      { status: 200 }
    );
  } catch (error) {
    // Return error response
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

