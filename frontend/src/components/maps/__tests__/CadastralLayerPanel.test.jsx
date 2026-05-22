import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CadastralLayerPanel from '../CadastralLayerPanel';
import { buildCadastralLayers } from '../../../utils/cadastralLayers';

describe('CadastralLayerPanel', () => {
  it('renders nothing when there are no layers', () => {
    const { container } = render(<CadastralLayerPanel layers={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a row for every layer, expanded by default', () => {
    render(<CadastralLayerPanel layers={buildCadastralLayers({ hasBoundary: true })} />);
    expect(screen.getByTestId('cadastral-layer-panel')).toBeInTheDocument();
    expect(screen.getByText('Base map')).toBeInTheDocument();
    expect(screen.getByText('Cadastral boundary')).toBeInTheDocument();
    expect(screen.getByText('RMP zoning')).toBeInTheDocument();
    expect(screen.getByText('Parcel pin')).toBeInTheDocument();
  });

  it('states the cadastral boundary provenance honestly', () => {
    const { rerender } = render(
      <CadastralLayerPanel layers={buildCadastralLayers({ hasBoundary: false })} />,
    );
    expect(screen.getByText('Not available')).toBeInTheDocument();

    rerender(<CadastralLayerPanel layers={buildCadastralLayers({ hasBoundary: true })} />);
    expect(screen.getByText('K-GIS atlas')).toBeInTheDocument();
  });

  it('switches the basemap through the segmented control', () => {
    const onBasemapChange = vi.fn();
    render(
      <CadastralLayerPanel
        layers={buildCadastralLayers({ basemap: 'streets' })}
        onBasemapChange={onBasemapChange}
      />,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Satellite' }));
    expect(onBasemapChange).toHaveBeenCalledWith('satellite');
  });

  it('toggles the zoning overlay via the switch', () => {
    const onToggleZoning = vi.fn();
    render(
      <CadastralLayerPanel
        layers={buildCadastralLayers({ zoning: { enabled: false } })}
        onToggleZoning={onToggleZoning}
      />,
    );
    const sw = screen.getByRole('switch', { name: /zoning/i });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(sw);
    expect(onToggleZoning).toHaveBeenCalledTimes(1);
  });

  it('collapses and expands from the header', () => {
    render(<CadastralLayerPanel layers={buildCadastralLayers()} />);
    const header = screen.getByRole('button', { name: /map layers/i });
    expect(header).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'false');
  });
});
