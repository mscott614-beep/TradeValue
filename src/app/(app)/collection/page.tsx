'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { useCollection, useFirestore, useUser, useMemoFirebase, deleteDocumentNonBlocking } from '@/firebase';
import { collection, doc } from 'firebase/firestore';
import type { Portfolio } from '@/lib/types';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Loader2,
  ArrowUpDown,
  ChevronDown,
  MoreHorizontal,
  PlusCircle,
  Download,
  Trash2,
  Search,
  LayoutGrid,
  List,
  Edit2,
} from 'lucide-react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { downloadCSV } from '@/lib/csv-utils';
import { writeBatch } from 'firebase/firestore';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useAccountLimits } from '@/hooks/use-account-limits';
import { updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { AlertCircle } from 'lucide-react';

type SortableField = 'player' | 'currentMarketValue' | 'year' | 'grader';
type SortDirection = 'asc' | 'desc';
type ViewMode = 'list' | 'grid';

export default function CollectionPage() {
  const router = useRouter();
  const firestore = useFirestore();
  const { user } = useUser();
  const { isAnonymous, cardCount, portfolioLimit, isLimitReached } = useAccountLimits();

  const [filter, setFilter] = useState('');
  const [yearFilter, setYearFilter] = useState<string>('all');
  const [brandFilter, setBrandFilter] = useState<string>('all');
  const [conditionFilter, setConditionFilter] = useState<string>('all');
  const [gradingFilter, setGradingFilter] = useState<string>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [sortConfig, setSortConfig] = useState<{ key: SortableField; direction: SortDirection }>({
    key: 'player',
    direction: 'asc',
  });

  const [editingCard, setEditingCard] = useState<Portfolio | null>(null);
  const [tempTitle, setTempTitle] = useState('');
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);

  const portfoliosCollection = useMemoFirebase(() => {
    if (!user || !firestore) return null;
    return collection(firestore, `users/${user.uid}/portfolios`);
  }, [firestore, user]);

  const { data: cards, isLoading } = useCollection<Portfolio>(portfoliosCollection);

  const handleSort = (key: SortableField) => {
    let direction: SortDirection = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const filterOptions = useMemo(() => {
    if (!cards || !Array.isArray(cards)) return { years: [], brands: [], conditions: [] };
    const years = Array.from(new Set(cards.map(c => (c.year || 'Unknown').toString()))).sort((a, b) => b.localeCompare(a));
    const brands = Array.from(new Set(cards.map(c => c.brand || 'Unknown'))).sort();
    const conditions = Array.from(new Set(cards.map(c => c.condition || 'Raw'))).sort();
    return { years, brands, conditions };
  }, [cards]);

  const filteredAndSortedCards = useMemo(() => {
    if (!cards || !Array.isArray(cards)) return [];

    const filtered = cards.filter(card => {
      const textMatch =
        card.title.toLowerCase().includes(filter.toLowerCase()) ||
        card.player.toLowerCase().includes(filter.toLowerCase()) ||
        card.year.toString().includes(filter.toLowerCase()) ||
        card.brand.toLowerCase().includes(filter.toLowerCase());

      const yearMatch = yearFilter === 'all' || card.year.toString() === yearFilter;
      const brandMatch = brandFilter === 'all' || card.brand === brandFilter;
      const conditionMatch = conditionFilter === 'all' || card.condition === conditionFilter;
      
      const isGraded = card.grader && card.grader !== '' && card.grader !== 'Raw';
      const gradingMatch = gradingFilter === 'all' || 
                           (gradingFilter === 'graded' && isGraded) || 
                           (gradingFilter === 'raw' && !isGraded);

      return textMatch && yearMatch && brandMatch && conditionMatch && gradingMatch;
    });

    return filtered.sort((a, b) => {
      let aValue: any;
      let bValue: any;

      if (sortConfig.key === 'grader') {
        aValue = a.grader && a.grader !== 'Raw' ? 1 : 0;
        bValue = b.grader && b.grader !== 'Raw' ? 1 : 0;
      } else {
        aValue = a[sortConfig.key];
        bValue = b[sortConfig.key];
      }

      if (aValue < bValue) {
        return sortConfig.direction === 'asc' ? -1 : 1;
      }
      if (aValue > bValue) {
        return sortConfig.direction === 'asc' ? 1 : -1;
      }
      return 0;
    });
  }, [cards, filter, yearFilter, brandFilter, conditionFilter, gradingFilter, sortConfig]);

  const handleDelete = useCallback((cardId: string) => {
    if (!user || !firestore) return;
    const docRef = doc(firestore, `users/${user.uid}/portfolios`, cardId);
    deleteDocumentNonBlocking(docRef);
  }, [user, firestore]);

  const renderSortArrow = (key: SortableField) => {
    if (sortConfig.key !== key) {
      return <ArrowUpDown className="ml-2 h-4 w-4" />;
    }
    return sortConfig.direction === 'asc' ? '▲' : '▼';
  };

  const handleExportCSV = useCallback(() => {
    if (filteredAndSortedCards.length > 0) {
      downloadCSV(filteredAndSortedCards);
    }
  }, [filteredAndSortedCards]);

  const openEditDialog = (card: Portfolio) => {
    setEditingCard(card);
    setTempTitle(card.title);
    setIsEditDialogOpen(true);
  };

  const handleSaveTitle = () => {
    if (!user || !firestore || !editingCard || !tempTitle.trim()) return;

    const docRef = doc(firestore, `users/${user.uid}/portfolios`, editingCard.id);
    updateDocumentNonBlocking(docRef, {
      title: tempTitle.trim()
    });

    setIsEditDialogOpen(false);
    setEditingCard(null);
    toast.success('Title updated successfully');
  };

  return (
    <>
      <PageHeader
        title="Digital Binder"
        description="A visual, organized gallery of your entire trading card collection."
        action={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleExportCSV} disabled={filteredAndSortedCards.length === 0}>
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
            <Link href={isLimitReached ? "#" : "/scanner"} passHref>
              <Button disabled={isLimitReached} className={cn(isLimitReached && "opacity-50 cursor-not-allowed")}>
                <PlusCircle className="mr-2 h-4 w-4" />
                Add Card
              </Button>
            </Link>
          </div>
        }
      />

      {isAnonymous && (
        <div className={cn(
          "mb-6 p-4 rounded-lg border flex items-center justify-between",
          isLimitReached ? "bg-red-500/10 border-red-500/20" : "bg-sky-500/10 border-sky-500/20"
        )}>
          <div className="flex items-center gap-3">
            <AlertCircle className={cn("h-5 w-5", isLimitReached ? "text-red-400" : "text-sky-400")} />
            <div>
              <p className="text-sm font-medium text-slate-200">
                {isLimitReached 
                  ? "Portfolio Limit Reached" 
                  : `Guest Portfolio: ${cardCount} / ${portfolioLimit} cards used`}
              </p>
              <p className="text-xs text-slate-400">
                {isLimitReached 
                  ? "Sign up to add unlimited cards to your collection." 
                  : "Create an account to unlock unlimited space."}
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href="/login">{isLimitReached ? "Sign Up Now" : "Unlock Unlimited"}</Link>
          </Button>
        </div>
      )}
      <div className="flex justify-between items-center mb-4 gap-4 flex-wrap">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search player, year, set..."
            className="pl-8"
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
        </div>

        <div className="flex flex-1 items-center gap-2 flex-wrap">
          <Select value={yearFilter} onValueChange={setYearFilter}>
            <SelectTrigger className="w-[120px]">
              <SelectValue placeholder="All Years" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Years</SelectItem>
              {Array.isArray(filterOptions.years) && filterOptions.years.map(year => (
                <SelectItem key={year} value={year}>{year}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={brandFilter} onValueChange={setBrandFilter}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="All Brands" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Brands</SelectItem>
              {Array.isArray(filterOptions.brands) && filterOptions.brands.map(brand => (
                <SelectItem key={brand} value={brand}>{brand}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={conditionFilter} onValueChange={setConditionFilter}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="All Conditions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Conditions</SelectItem>
              {Array.isArray(filterOptions.conditions) && filterOptions.conditions.map(cond => (
                <SelectItem key={cond} value={cond}>{cond}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={gradingFilter} onValueChange={setGradingFilter}>
            <SelectTrigger className="w-[130px]">
              <SelectValue placeholder="Format" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Items</SelectItem>
              <SelectItem value="graded">Graded Only</SelectItem>
              <SelectItem value="raw">Raw Only</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <ToggleGroup type="single" value={viewMode} onValueChange={(v) => v && setViewMode(v as ViewMode)}>
          <ToggleGroupItem value="list" aria-label="List View">
            <List className="h-4 w-4" />
          </ToggleGroupItem>
          <ToggleGroupItem value="grid" aria-label="Grid View">
            <LayoutGrid className="h-4 w-4" />
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      {viewMode === 'list' ? (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead onClick={() => handleSort('player')} className="cursor-pointer">
                    Card {renderSortArrow('player')}
                  </TableHead>
                  <TableHead onClick={() => handleSort('grader')} className="cursor-pointer">
                    Details {renderSortArrow('grader')}
                  </TableHead>
                  <TableHead onClick={() => handleSort('year')} className="cursor-pointer">
                    Year {renderSortArrow('year')}
                  </TableHead>
                  <TableHead onClick={() => handleSort('currentMarketValue')} className="text-right cursor-pointer">
                    Value {renderSortArrow('currentMarketValue')}
                  </TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center">
                      <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
                    </TableCell>
                  </TableRow>
                ) : (Array.isArray(filteredAndSortedCards) && filteredAndSortedCards.length > 0) ? (
                  filteredAndSortedCards.map(card => (
                    <TableRow key={card.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          {card.imageUrl ? (
                            card.imageUrl.startsWith('data:') ? (
                              <img src={card.imageUrl} alt={card.title} className="rounded-sm object-cover w-[50px] h-[70px]" />
                            ) : (
                              <Image
                                src={card.imageUrl}
                                alt={card.title}
                                width={50}
                                height={70}
                                className="rounded-sm object-cover"
                              />
                            )
                          ) : (
                            <div className="w-[50px] h-[70px] bg-muted rounded-sm flex items-center justify-center">
                              <PlusCircle className="h-5 w-5 text-muted-foreground opacity-50" />
                            </div>
                          )}
                          <div className="font-medium">{card.title}</div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <Badge variant="secondary">{card.condition}</Badge>
                          {card.features && Array.isArray(card.features) && card.features.map(feature => (
                            <Badge key={feature} variant="outline">{feature}</Badge>
                          ))}
                          {card.parallel && <Badge variant="outline" className="text-purple-400 border-purple-400">{card.parallel}</Badge>}
                        </div>
                      </TableCell>
                      <TableCell>{card.year}</TableCell>
                      <TableCell className="text-right">
                        {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(card.currentMarketValue)}
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem onClick={() => router.push(`/collection/${card.id}`)}>
                              View Details
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => openEditDialog(card)}>
                              <Edit2 className="mr-2 h-4 w-4" />
                              Edit Title
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => handleDelete(card.id)} className="text-destructive">
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                      No cards in your collection. <Link href="/scanner" className="text-primary hover:underline">Add one now</Link>!
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {isLoading ? (
            <div className="col-span-full py-12 flex justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (Array.isArray(filteredAndSortedCards) && filteredAndSortedCards.length > 0) ? (
            filteredAndSortedCards.map((card, index) => (
              <Link key={card.id || index} href={`/collection/${card.id}`}>
                <Card className="overflow-hidden hover:border-primary/50 transition-colors group cursor-pointer relative">
                  <div className="aspect-[2.5/3.5] relative bg-muted w-full">
                    {card.imageUrl ? (
                      card.imageUrl.startsWith('data:') ? (
                        <img
                          src={card.imageUrl}
                          alt={card.title}
                          className="object-cover transition-transform group-hover:scale-105 absolute inset-0 w-full h-full"
                        />
                      ) : (
                        <Image
                          src={card.imageUrl}
                          alt={card.title}
                          fill
                          className="object-cover transition-transform group-hover:scale-105"
                          sizes="(max-width: 768px) 50vw, (max-width: 1200px) 33vw, 20vw"
                        />
                      )
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground opacity-50">
                        <PlusCircle className="h-10 w-10 mb-2" />
                        <span className="text-sm">No Image</span>
                      </div>
                    )}
                    <div className="absolute top-2 right-2">
                      <Badge variant="secondary" className="bg-background/80 backdrop-blur-sm">
                        {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(card.currentMarketValue)}
                      </Badge>
                    </div>
                  </div>
                  <CardContent className="p-3">
                    <p className="text-xs text-muted-foreground truncate">{card.year} {card.brand}</p>
                    <p className="font-semibold text-sm truncate" title={card.player}>{card.player}</p>
                    <div className="flex gap-1 mt-2 flex-wrap">
                      <Badge variant="outline" className="text-[10px] px-1 py-0">{card.condition}</Badge>
                      {card.parallel && <Badge variant="secondary" className="text-[10px] px-1 py-0 text-purple-400 bg-purple-400/10 border-purple-400/20">{card.parallel}</Badge>}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))
          ) : (
            <div className="col-span-full py-12 text-center text-muted-foreground border rounded-lg border-dashed">
              No cards in your collection. <Link href="/scanner" className="text-primary hover:underline">Add one now</Link>!
            </div>
          )}
        </div>
      )}

      {/* Edit Title Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Edit Card Title</DialogTitle>
            <DialogDescription>
              Correct the card title below. This will be reflected across your entire collection.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <label htmlFor="title" className="text-sm font-medium">Title</label>
              <Input
                id="title"
                value={tempTitle}
                onChange={(e) => setTempTitle(e.target.value)}
                placeholder="Enter card title..."
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveTitle();
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveTitle}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
