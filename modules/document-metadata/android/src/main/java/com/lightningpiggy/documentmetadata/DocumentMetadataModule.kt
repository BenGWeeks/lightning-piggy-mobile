package com.lightningpiggy.documentmetadata

import android.net.Uri
import android.provider.OpenableColumns
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Resolve a selected document's name without deriving it from an opaque URI. */
class DocumentMetadataModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("DocumentMetadata")

    AsyncFunction("displayNameAsync") { uriString: String ->
      val uri = Uri.parse(uriString)
      require(uri.scheme == "content") { "Expected a document content URI" }
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      context.contentResolver.query(
        uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null
      )?.use { cursor ->
        val column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
        if (column >= 0 && cursor.moveToFirst()) cursor.getString(column) else null
      }
    }
  }
}
