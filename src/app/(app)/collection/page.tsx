'use client';

import { useState, useMemo, useCallback } from 'react';
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
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Loader2,
  ArrowUpDown,
  ChevronDown,
  MoreHorizontal,
  PlusCircle,
  Upload,
  Download,
  Trash2,
  Search,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type SortableField = 'player' | 'currentMarketValue' | 'year';
type SortDirection = 'asc' | 'desc';

export default function CollectionPage() {
  const router = useRouter();
  const firestore = useFirestore();
  const { user } = useUser();

  const [filter, setFilter] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: SortableField; direction: SortDirection }>({
    key: 'player',
    direction: 'asc',
  });

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

  const filteredAndSortedCards = useMemo(() => {
    if (!cards) return [];

    const filtered = cards.filter(card =>
      card.title.toLowerCase().includes(filter.toLowerCase()) ||
      card.player.toLowerCase().includes(filter.toLowerCase()) ||
      card.year.toString().includes(filter.toLowerCase()) ||
      card.brand.toLowerCase().includes(filter.toLowerCase())
    );

    return filtered.sort((a, b) => {
      const aValue = a[sortConfig.key];
      const bValue = b[sortConfig.key];

      if (aValue < bValue) {
        return sortConfig.direction === 'asc' ? -1 : 1;
      }
      if (aValue > bValue) {
        return sortConfig.direction === 'asc' ? 1 : -1;
      }
      return 0;
    });
  }, [cards, filter, sortConfig]);

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

  return (
    <>
      <PageHeader
        title="My Collection"
        description="A complete overview of your prized trading card collection."
        action={
          <div className="flex items-center gap-2">
            <Button variant="outline" disabled>
              <Upload className="mr-2 h-4 w-4" />
              Import CSV
            </Button>
            <Button variant="outline" disabled>
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
            <Link href="/scanner" passHref>
              <Button>
                <PlusCircle className="mr-2 h-4 w-4" />
                Add Card
              </Button>
            </Link>
          </div>
        }
      />
      <div className="flex justify-between items-center mb-4">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Filter by player, year, set..."
            className="pl-8"
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
        </div>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead onClick={() => handleSort('player')} className="cursor-pointer">
                  Card {renderSortArrow('player')}
                </TableHead>
                <TableHead>Details</TableHead>
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
              ) : filteredAndSortedCards.length > 0 ? (
                filteredAndSortedCards.map(card => (
                  <TableRow key={card.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        {card.imageUrl ? (
                          <Image
                            src={card.imageUrl}
                            alt={card.title}
                            width={50}
                            height={70}
                            className="rounded-sm object-cover"
                          />
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
                        {card.features?.map(feature => (
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
    </>
  );
}
