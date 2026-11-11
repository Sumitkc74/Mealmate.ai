import { useState, useRef, type ChangeEvent, type DragEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { useBulkCreateRecipes, type RecipeInput } from '@/hooks/useRecipes';
import {
  parseRecipeSpreadsheet,
  downloadSampleCsvTemplate,
  downloadSampleExcelTemplate,
  type RecipeImportParseResult,
} from '@/lib/recipeImportParser';
import { extractErrorMessage } from '@/lib/api';

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function RecipeImportModal({ open, onClose, onSuccess }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [parseResult, setParseResult] = useState<RecipeImportParseResult | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const bulkCreate = useBulkCreateRecipes();

  if (!open) return null;

  const handleFileProcess = async (selectedFile: File) => {
    setFile(selectedFile);
    setParseError(null);
    setSuccessMessage(null);
    setIsParsing(true);

    try {
      const buffer = await selectedFile.arrayBuffer();
      const result = parseRecipeSpreadsheet(buffer);
      if (result.totalRows === 0) {
        setParseError('The uploaded file appears to be empty or contains no recipe rows.');
        setParseResult(null);
      } else {
        setParseResult(result);
      }
    } catch (err) {
      console.error('Failed to parse spreadsheet', err);
      setParseError('Could not read the spreadsheet. Please verify it is a valid CSV, XLSX, or XLS file.');
      setParseResult(null);
    } finally {
      setIsParsing(false);
    }
  };

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      void handleFileProcess(selected);
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) {
      void handleFileProcess(dropped);
    }
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleImportSubmit = async () => {
    if (!parseResult) return;
    const validRecipes = parseResult.results
      .filter((r) => r.isValid && r.recipe)
      .map((r) => r.recipe as unknown as RecipeInput);

    if (validRecipes.length === 0) return;

    try {
      const res = await bulkCreate.mutateAsync(validRecipes);
      setSuccessMessage(`Successfully imported ${res.count} recipes to your library!`);
      setTimeout(() => {
        onSuccess?.();
        handleReset();
        onClose();
      }, 1800);
    } catch (err) {
      setParseError(extractErrorMessage(err, 'Failed to import recipes into database'));
    }
  };

  const handleReset = () => {
    setFile(null);
    setParseResult(null);
    setParseError(null);
    setSuccessMessage(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-fadeIn"
    >
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-lg bg-card border border-line shadow-lg overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <div>
            <h2 id="import-modal-title" className="text-xl font-bold text-ink">
              Import Recipes from CSV or Excel
            </h2>
            <p className="text-xs text-ink-soft">
              Upload a spreadsheet to import multiple recipes in bulk directly into your library.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-xs font-semibold text-ink-soft hover:bg-canvas-soft hover:text-ink"
            aria-label="Close modal"
          >
            Close
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Templates Help Banner */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-line bg-canvas-soft p-4 text-xs text-ink">
            <div>
              <p className="font-semibold text-sm">Need a spreadsheet template to get started?</p>
              <p className="mt-0.5 text-ink-soft leading-relaxed">
                Download our pre-formatted template with standard columns: Title, Ingredients, Instructions, Prep Time, and Macros.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={downloadSampleCsvTemplate}
                className="rounded bg-card border border-line px-3 py-1.5 font-medium text-ink shadow-sm hover:bg-canvas transition"
              >
                CSV Template
              </button>
              <button
                type="button"
                onClick={downloadSampleExcelTemplate}
                className="rounded bg-card border border-line px-3 py-1.5 font-medium text-ink shadow-sm hover:bg-canvas transition"
              >
                Excel (.xlsx) Template
              </button>
            </div>
          </div>

          {/* Upload Dropzone */}
          {!parseResult && !isParsing && (
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
              className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center cursor-pointer transition ${
                isDragging
                  ? 'border-brand-500 bg-canvas-soft'
                  : 'border-line hover:border-brand-500 bg-canvas-soft'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
                className="hidden"
                onChange={handleInputChange}
              />
              <p className="text-sm font-semibold text-ink">
                Click to choose or drag &amp; drop your spreadsheet here
              </p>
              <p className="mt-1 text-xs text-ink-soft">
                Supports Microsoft Excel (<strong>.xlsx</strong>, <strong>.xls</strong>) and <strong>.csv</strong> files (up to 100 recipes per file)
              </p>
            </div>
          )}

          {/* Loading parsing */}
          {isParsing && (
            <div className="flex flex-col items-center justify-center py-12 text-center space-y-3">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
              <p className="text-sm text-gray-600 font-medium">Reading and validating spreadsheet rows…</p>
            </div>
          )}

          {/* Parse error alert */}
          {parseError && (
            <div className="rounded-lg bg-red-50 p-4 text-xs text-red-700 border border-red-200" role="alert">
              <span className="font-semibold">Error: </span>
              {parseError}
            </div>
          )}

          {/* Success flash */}
          {successMessage && (
            <div className="rounded-lg bg-emerald-50 p-4 text-xs font-semibold text-emerald-800 border border-emerald-200">
              {successMessage}
            </div>
          )}

          {/* Validation & Preview Table */}
          {parseResult && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 bg-canvas-soft p-3.5 rounded border border-line">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm text-ink">
                    File: {file?.name}
                  </span>
                  <span className="rounded bg-card border border-line px-2.5 py-0.5 text-xs font-semibold text-brand-700">
                    {parseResult.validCount} Valid
                  </span>
                  {parseResult.errorCount > 0 && (
                    <span className="rounded bg-rose-50 border border-rose-200 px-2.5 py-0.5 text-xs font-semibold text-rose-800">
                      {parseResult.errorCount} Errors
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleReset}
                  className="text-xs font-medium text-brand-600 hover:text-brand-800 underline"
                >
                  Choose a different file
                </button>
              </div>

              {/* Parsed Rows List */}
              <div className="max-h-72 overflow-y-auto rounded border border-line divide-y divide-line text-xs bg-card">
                {parseResult.results.map((r) => (
                  <div
                    key={r.rowNumber}
                    className={`p-3.5 flex items-start justify-between gap-3 ${
                      !r.isValid ? 'bg-rose-50/40' : 'hover:bg-canvas-soft'
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-ink-soft font-mono text-[11px]">#{r.rowNumber}</span>
                        <span className="font-semibold text-ink text-sm">{r.rawTitle}</span>
                        {r.recipe?.cuisine && (
                          <span className="rounded bg-canvas-soft border border-line px-1.5 py-0.5 text-[10px] text-ink-soft">
                            {r.recipe.cuisine}
                          </span>
                        )}
                        {r.recipe && (
                          <span className="rounded bg-canvas-soft border border-line px-1.5 py-0.5 text-[10px] text-brand-700 capitalize">
                            {r.recipe.difficulty}
                          </span>
                        )}
                      </div>

                      {r.recipe && (
                        <p className="text-ink-soft text-[11px] leading-relaxed">
                          {r.recipe.ingredients.length} ingredients ({r.recipe.ingredients.slice(0, 3).map((i) => i.name).join(', ')}{r.recipe.ingredients.length > 3 ? '…' : ''})
                          · {r.recipe.prepTime + r.recipe.cookTime}m total
                          · {r.recipe.servings} servings
                        </p>
                      )}

                      {r.errors.length > 0 && (
                        <p className="text-rose-700 font-medium text-[11px]">
                          Error: {r.errors.join('; ')}
                        </p>
                      )}

                      {r.warnings.length > 0 && (
                        <p className="text-amber-800 text-[11px]">
                          Warning: {r.warnings.join('; ')}
                        </p>
                      )}
                    </div>

                    <div className="shrink-0 pt-0.5">
                      {r.isValid ? (
                        <span className="rounded bg-card border border-line px-2 py-0.5 text-[11px] font-semibold text-brand-700">
                          Ready
                        </span>
                      ) : (
                        <span className="rounded bg-rose-50 border border-rose-200 px-2 py-0.5 text-[11px] font-semibold text-rose-800">
                          Skip (Invalid)
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between border-t border-line bg-canvas px-6 py-4">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>

          {parseResult && parseResult.validCount > 0 ? (
            <Button
              size="sm"
              loading={bulkCreate.isPending}
              onClick={handleImportSubmit}
              disabled={Boolean(successMessage)}
            >
              Import {parseResult.validCount} Recipe{parseResult.validCount > 1 ? 's' : ''}
            </Button>
          ) : (
            <span className="text-xs text-gray-400">
              Select a valid spreadsheet to import
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
