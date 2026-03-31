"use client";

import { useUser } from "@/firebase";
import { BulkEnrichmentDashboard } from "@/components/dashboard/BulkEnrichmentDashboard";
import { PageHeader } from "@/components/page-header";

export default function EnrichmentPage() {
    const { user } = useUser();

    if (!user) return null;

    return (
        <div className="container mx-auto py-6 space-y-8 max-w-5xl">
            <PageHeader 
                title="Bulk Enrichment" 
                description="Use Gemini 3.1 Flash to identify missing metadata and refresh market values."
            />
            
            <BulkEnrichmentDashboard userId={user.uid} />
        </div>
    );
}
