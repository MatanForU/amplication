import React, { useState, useMemo } from "react";
import { gql, useQuery } from "@apollo/client";
import { Snackbar } from "@rmwc/snackbar";
import { formatError } from "../util/error";
import keyBy from "lodash.keyby";

import * as models from "../models";
import { DataGrid, DataField, DataFilter } from "../Components/DataGrid";
import DataGridRow from "../Components/DataGridRow";
import { DataTableCell } from "@rmwc/data-table";
import { Link } from "react-router-dom";
import { paramCase } from "param-case";
import {
  SelectMenu,
  SelectMenuModal,
  SelectMenuItem,
  SelectMenuList,
} from "../Components/SelectMenu";

import "@rmwc/data-table/styles";
import pluralize from "pluralize";

const fields: DataField[] = [
  {
    name: "displayName",
    title: "Name",
    sortable: true,
  },
  {
    name: "blockType",
    title: "Type",
    sortable: true,
  },
  {
    name: "versionNumber",
    title: "Version",
  },
  {
    name: "description",
    title: "Description",
    sortable: true,
  },
  {
    name: "tags",
    title: "Tags",
    sortable: false,
  },
];

type TData = {
  blocks: models.Block[];
};

type SortData = {
  field: string | null;
  order: number | null;
};

const NAME_FIELD = "displayName";
const BLOCK_TYPE = "blockType";

const INITIAL_SORT_DATA = {
  field: null,
  order: null,
};

type Props = {
  applicationId: string;
  blockTypes: models.EnumBlockType[];
  title: string;
};

export const BlockList = ({ applicationId, blockTypes, title }: Props) => {
  const [sortDir, setSortDir] = useState<SortData>(INITIAL_SORT_DATA);

  const [searchPhrase, setSearchPhrase] = useState<string>("");

  const [filters, setFilters] = useState<DataFilter[]>([
    {
      name: BLOCK_TYPE,
      title: "Type",
      filterItems: blockTypes.map((type) => ({ label: type, value: type })),
      selected: new Set<string>(),
    },
  ]);

  const filtersByName = useMemo(() => keyBy(filters, (filter) => filter.name), [
    filters,
  ]);

  const handleSortChange = (fieldName: string, order: number | null) => {
    setSortDir({ field: fieldName, order: order === null ? 1 : order });
  };

  const handleSearchChange = (value: string) => {
    setSearchPhrase(value);
  };

  const handleFilterChange = (filters: DataFilter[]) => {
    setFilters(filters);
  };

  const { data, loading, error } = useQuery<TData>(GET_BLOCKS, {
    variables: {
      id: applicationId,
      blockTypes:
        filtersByName &&
        filtersByName[BLOCK_TYPE] &&
        filtersByName[BLOCK_TYPE].selected &&
        filtersByName[BLOCK_TYPE].selected.size
          ? [...filtersByName[BLOCK_TYPE].selected]
          : blockTypes,
      orderBy: {
        [sortDir.field || NAME_FIELD]:
          sortDir.order === 1 ? models.SortOrder.Desc : models.SortOrder.Asc,
      },
      whereName:
        searchPhrase !== ""
          ? { contains: searchPhrase, mode: models.QueryMode.Insensitive }
          : undefined,
    },
  });

  const errorMessage = formatError(error);

  return (
    <>
      <DataGrid
        fields={fields}
        title={title}
        loading={loading}
        sortDir={sortDir}
        onSortChange={handleSortChange}
        onSearchChange={handleSearchChange}
        onFilterChange={handleFilterChange}
        filters={filters}
        toolbarContentEnd={
          <SelectMenu title="Create New">
            <SelectMenuModal>
              <SelectMenuList>
                {blockTypes.map((type) => (
                  <SelectMenuItem
                    key={type}
                    href={`${getBlockTypePath(applicationId, type)}/new`}
                  >
                    {type} {/** @todo: convert to local string */}
                  </SelectMenuItem>
                ))}
              </SelectMenuList>
            </SelectMenuModal>
          </SelectMenu>
        }
      >
        {data?.blocks.map((block) => {
          const blockTypePath = getBlockTypePath(
            applicationId,
            block.blockType
          );
          return (
            <DataGridRow navigateUrl={`${blockTypePath}/${block.id}`}>
              <DataTableCell>
                <Link
                  className="amp-data-grid-item--navigate"
                  title={block.displayName}
                  to={`${blockTypePath}/${block.id}`}
                >
                  {block.displayName}
                </Link>
              </DataTableCell>
              <DataTableCell>{block.blockType}</DataTableCell>
              <DataTableCell>{block.versionNumber}</DataTableCell>
              <DataTableCell>{block.description}</DataTableCell>
              <DataTableCell>
                <span className="tag tag1">Tag #1</span>
                <span className="tag tag2">Tag #2</span>
                <span className="tag tag3">Tag #3</span>
              </DataTableCell>
            </DataGridRow>
          );
        })}
      </DataGrid>

      <Snackbar open={Boolean(error)} message={errorMessage} />
    </>
  );
  /**@todo: move error message to hosting page  */
};

function getBlockTypePath(applicationId: string, type: string): string {
  const resource = paramCase(pluralize(type));
  return `/${applicationId}/${resource}`;
}

/**@todo: expand search on other field  */
/**@todo: find a solution for case insensitive search  */
export const GET_BLOCKS = gql`
  query getPages(
    $id: String!
    $blockTypes: [EnumBlockType!]
    $orderBy: BlockOrderByInput
    $whereName: StringFilter
  ) {
    blocks(
      where: {
        app: { id: $id }
        blockType: { in: $blockTypes }
        displayName: $whereName
      }
      orderBy: $orderBy
    ) {
      id
      displayName
      blockType
      versionNumber
      description
    }
  }
`;
