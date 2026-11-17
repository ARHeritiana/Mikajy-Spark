package com.mikajy.app;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;

/**
 * Serves exactly two read-only files, never anything else: the canvas PNG to the share sheet, and the downloaded,
 * checksum-verified update APK to Android's own installer screen (the fallback when an install session fails).
 * Not exported; access is granted per intent.
 */
public class ShareProvider extends ContentProvider {
  static final String AUTHORITY = "com.mikajy.app.share";
  static final String FILE_NAME = "mikajy.png";
  static final String APK_NAME = "update.apk";
  static final String APK_TYPE = "application/vnd.android.package-archive";
  private static final String DIR_NAME = "share";

  static File shareDir(Context context) { return new File(context.getCacheDir(), DIR_NAME); }

  /** Deletes any previously shared image. */
  static void clear(Context context) {
    File[] files = shareDir(context).listFiles();
    if (files != null) for (File f : files) //noinspection ResultOfMethodCallIgnored
      f.delete();
  }

  /** The file a content URI names, or null: only "/mikajy.png" and "/update.apk" exist. */
  private File target(Uri uri) {
    Context context = getContext();
    if (context == null || uri == null) return null;
    String path = uri.getPath();
    if (("/" + FILE_NAME).equals(path)) return new File(shareDir(context), FILE_NAME);
    if (("/" + APK_NAME).equals(path)) return new File(SelfInstaller.dir(context), APK_NAME);
    return null;
  }

  @Override public boolean onCreate() { return true; }

  @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
    File f = target(uri);
    if (f == null || !"r".equals(mode) || !f.isFile()) {
      throw new FileNotFoundException("Invalid shared file");
    }
    return ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY);
  }

  @Override public String getType(Uri uri) {
    return uri != null && ("/" + APK_NAME).equals(uri.getPath()) ? APK_TYPE : "image/png";
  }

  @Override public Cursor query(Uri uri, String[] projection, String selection, String[] args, String order) {
    File f = target(uri);
    if (f == null || !f.isFile()) return null;
    String[] columns = projection != null ? projection
        : new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE};
    Object[] row = new Object[columns.length];
    for (int i = 0; i < columns.length; i++) {
      if (OpenableColumns.DISPLAY_NAME.equals(columns[i])) row[i] = f.getName();
      else if (OpenableColumns.SIZE.equals(columns[i])) row[i] = f.length();
    }
    MatrixCursor cursor = new MatrixCursor(columns, 1);
    cursor.addRow(row);
    return cursor;
  }

  @Override public Uri insert(Uri uri, ContentValues values) { return null; }
  @Override public int delete(Uri uri, String selection, String[] args) { return 0; }
  @Override public int update(Uri uri, ContentValues values, String selection, String[] args) { return 0; }
}
